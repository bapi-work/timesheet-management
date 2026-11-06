import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
});

let refreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

api.interceptors.request.use((config) => {
  const stored = localStorage.getItem('auth-storage');
  if (stored) {
    const { state } = JSON.parse(stored);
    if (state?.accessToken) {
      config.headers.Authorization = `Bearer ${state.accessToken}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const orig = error.config;

    // The account has to be secured before anything else will work
    const code = error.response?.data?.code;
    if (error.response?.status === 403 && code === 'PASSWORD_CHANGE_REQUIRED' && window.location.pathname !== '/change-password') {
      window.location.href = '/change-password';
    } else if (error.response?.status === 403 && code === 'MFA_SETUP_REQUIRED' && window.location.pathname !== '/profile') {
      window.location.href = '/profile';
    }

    // A failed sign-in is a wrong password, not an expired session
    const isSessionEndpoint = /\/auth\/(login|refresh|logout)$/.test(orig.url || '');
    if (error.response?.status === 401 && !orig._retry && !isSessionEndpoint) {
      if (refreshing) {
        return new Promise((resolve) => {
          refreshSubscribers.push((token) => {
            orig.headers.Authorization = `Bearer ${token}`;
            resolve(api(orig));
          });
        });
      }
      orig._retry = true;
      refreshing = true;
      try {
        const { data } = await api.post('/auth/refresh', undefined, { _retry: true } as never);
        const token = data.accessToken;
        const stored = localStorage.getItem('auth-storage');
        if (stored) {
          const parsed = JSON.parse(stored);
          parsed.state.accessToken = token;
          localStorage.setItem('auth-storage', JSON.stringify(parsed));
        }
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        refreshSubscribers.forEach(cb => cb(token));
        refreshSubscribers = [];
        orig.headers.Authorization = `Bearer ${token}`;
        return api(orig);
      } catch {
        localStorage.removeItem('auth-storage');
        window.location.href = '/login';
      } finally {
        refreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
