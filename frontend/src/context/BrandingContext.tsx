import { createContext, useContext, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { useAuthStore } from '../store/auth.store';

interface Branding {
  appName?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  sidebarBgColor?: string | null;
  loginBgColor?: string | null;
  footerText?: string | null;
  supportEmail?: string | null;
  name?: string;
}

interface BrandingContextValue {
  branding: Branding;
  refetch: () => void;
}

const BrandingContext = createContext<BrandingContextValue>({
  branding: {},
  refetch: () => {},
});

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function applyBranding(branding: Branding) {
  const root = document.documentElement;
  const primary = branding.primaryColor || '#2563eb';
  const secondary = branding.secondaryColor || '#64748b';
  const accent = branding.accentColor || '#0ea5e9';

  root.style.setProperty('--color-primary', primary);
  root.style.setProperty('--color-primary-rgb', hexToRgb(primary));
  root.style.setProperty('--color-secondary', secondary);
  root.style.setProperty('--color-accent', accent);
  root.style.setProperty('--color-sidebar-bg', branding.sidebarBgColor || '#ffffff');
  root.style.setProperty('--color-login-bg', branding.loginBgColor || '#f1f5f9');

  // Update favicon dynamically
  if (branding.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = branding.faviconUrl;
  }

  // Update document title
  if (branding.appName) {
    document.title = branding.appName;
  }
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  const { data: branding = {}, refetch } = useQuery<Branding>({
    queryKey: ['branding'],
    queryFn: () =>
      isAuthenticated
        ? api.get('/admin/branding').then(r => r.data).catch(() => api.get('/public/branding').then(r => r.data))
        : fetch('/api/public/branding').then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    applyBranding(branding);
  }, [branding]);

  const refetchBranding = useCallback(() => { refetch(); }, [refetch]);

  return (
    <BrandingContext.Provider value={{ branding, refetch: refetchBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
