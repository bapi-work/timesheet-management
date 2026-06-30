import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../lib/api';

interface User {
  id: string;
  employeeId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string;
  avatarUrl?: string;
  gender?: string;
  mfaEnabled?: boolean;
  department?: { id: string; name: string };
  organization?: { id: string; name: string; timezone: string };
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string, mfaCode?: string) => Promise<{ requiresMfa?: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,

      login: async (email, password, mfaCode) => {
        const { data } = await api.post('/auth/login', { email, password, mfaCode });
        if (data.requiresMfa) return { requiresMfa: true };
        set({ accessToken: data.accessToken, user: data.user, isAuthenticated: true });
        api.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
        return {};
      },

      logout: async () => {
        try { await api.post('/auth/logout'); } catch {}
        set({ user: null, accessToken: null, isAuthenticated: false });
        delete api.defaults.headers.common['Authorization'];
      },

      refreshUser: async () => {
        const { data } = await api.get('/auth/me');
        set({ user: data });
      },

      setToken: (token) => {
        set({ accessToken: token });
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      },
    }),
    { name: 'auth-storage', partialize: (s) => ({ accessToken: s.accessToken, user: s.user, isAuthenticated: s.isAuthenticated }) }
  )
);
