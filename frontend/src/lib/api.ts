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
    if (error.response?.status === 401 && !orig._retry) {
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
        const { data } = await api.post('/auth/refresh');
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
