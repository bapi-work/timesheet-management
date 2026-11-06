import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
});

let refreshing = false;
let refreshSubscribers: { resolve: (token: string) => void; reject: (err: unknown) => void }[] = [];

// The access token lives in memory only, out of reach of any script reading browser storage.
// After a reload the first request gets a 401 and a new token comes from the httpOnly refresh cookie.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
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
      window.location.href = '/profile?setup=mfa';
    }

    // A failed sign-in is a wrong password, not an expired session
    const isSessionEndpoint = /\/auth\/(login|refresh|logout)$/.test(orig.url || '');
    if (error.response?.status === 401 && !orig._retry && !isSessionEndpoint) {
      if (refreshing) {
        return new Promise((resolve, reject) => {
          refreshSubscribers.push({
            resolve: (token) => {
              orig.headers.Authorization = `Bearer ${token}`;
              resolve(api(orig));
            },
            reject,
          });
        });
      }
      orig._retry = true;
      refreshing = true;
      try {
        const { data } = await api.post('/auth/refresh', undefined, { _retry: true } as never);
        const token = data.accessToken;
        setAccessToken(token);
        refreshSubscribers.forEach(s => s.resolve(token));
        refreshSubscribers = [];
        orig.headers.Authorization = `Bearer ${token}`;
        return api(orig);
      } catch (refreshError) {
        refreshSubscribers.forEach(s => s.reject(refreshError));
        refreshSubscribers = [];
        setAccessToken(null);
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
