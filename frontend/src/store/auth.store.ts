import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api, { setAccessToken } from '../lib/api';

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
  mustChangePassword?: boolean;
  department?: { id: string; name: string };
  organization?: { id: string; name: string; timezone: string };
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string, mfaCode?: string) => Promise<{ requiresMfa?: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  completePasswordChange: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,

      login: async (email, password, mfaCode) => {
        const { data } = await api.post('/auth/login', { email, password, mfaCode });
        if (data.requiresMfa) return { requiresMfa: true };
        setAccessToken(data.accessToken);
        set({ user: data.user, isAuthenticated: true });
        return {};
      },

      logout: async () => {
        try { await api.post('/auth/logout'); } catch {}
        setAccessToken(null);
        set({ user: null, isAuthenticated: false });
      },

      refreshUser: async () => {
        const { data } = await api.get('/auth/me');
        set({ user: data });
      },

      // Changing a password ends every session, so continue on the one the server just issued
      completePasswordChange: (token) => {
        const { user } = get();
        setAccessToken(token);
        set({ user: user ? { ...user, mustChangePassword: false } : user });
      },
    }),
    {
      name: 'auth-storage',
      version: 1,
      partialize: (s) => ({ user: s.user, isAuthenticated: s.isAuthenticated }),
      // Earlier versions saved the access token here: drop it from existing browsers
      migrate: (persisted) => {
        const { accessToken: _dropped, ...rest } = persisted as Record<string, unknown>;
        return rest as Pick<AuthState, 'user' | 'isAuthenticated'>;
      },
    }
  )
);
