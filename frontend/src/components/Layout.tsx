import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth.store';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { useBranding } from '../context/BrandingContext';
import {
  HomeIcon, ClockIcon, CheckCircleIcon, FolderIcon, UsersIcon,
  CalendarIcon, DocumentChartBarIcon, ChartBarIcon, CreditCardIcon,
  CogIcon, BellIcon, ArrowLeftOnRectangleIcon,
  Bars3Icon, XMarkIcon, BuildingOffice2Icon,
} from '@heroicons/react/24/outline';
import { BellIcon as BellSolidIcon } from '@heroicons/react/24/solid';
import clsx from 'clsx';
import { ADMIN_ROLES, ANALYTICS_ROLES, MANAGEMENT_ROLES, PAYROLL_ROLES, hasRole } from '../lib/roles';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: HomeIcon },
  { to: '/timesheets/current', label: 'My Timesheet', icon: ClockIcon },
  { to: '/timesheets', label: 'All Timesheets', icon: ClockIcon },
  { to: '/approvals', label: 'Approvals', icon: CheckCircleIcon },
  { to: '/projects', label: 'Projects', icon: FolderIcon },
  { to: '/clients', label: 'Clients', icon: BuildingOffice2Icon },
  { to: '/attendance', label: 'Attendance', icon: CalendarIcon },
  { to: '/leave', label: 'Leave', icon: CalendarIcon },
];

const MANAGER_NAV = [
  { to: '/employees', label: 'Employees', icon: UsersIcon },
  { to: '/reports', label: 'Reports', icon: DocumentChartBarIcon },
];

const ANALYTICS_NAV = [{ to: '/analytics', label: 'Analytics', icon: ChartBarIcon }];
const PAYROLL_NAV = [{ to: '/payroll', label: 'Payroll', icon: CreditCardIcon }];
const ADMIN_NAV = [{ to: '/admin', label: 'Administration', icon: CogIcon }];

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: React.ElementType }) {
  return (
    <NavLink to={to} end={to === '/timesheets/current'}
      className={({ isActive }) => clsx('sidebar-link', isActive && 'sidebar-link-active')}>
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { branding } = useBranding();

  const isManager = hasRole(user?.role, MANAGEMENT_ROLES);
  const canViewAnalytics = hasRole(user?.role, ANALYTICS_ROLES);
  const canRunPayroll = hasRole(user?.role, PAYROLL_ROLES);
  const isAdmin = hasRole(user?.role, ADMIN_ROLES);

  const appName = branding.appName || 'TimeTrack Pro';
  const orgName = user?.organization?.name || branding.name || 'Enterprise';

  const { data: notifData } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get('/notifications?unreadOnly=true&limit=1').then(r => r.data),
    refetchInterval: 30_000,
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const Sidebar = () => (
    <div className="flex flex-col h-full sidebar-branded border-r border-gray-200">
      {/* Logo / Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-200">
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt={appName} className="h-8 object-contain max-w-[140px]" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-primary)' }}>
              <ClockIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm leading-tight">{appName}</p>
              <p className="text-xs text-gray-500 truncate max-w-[140px]">{orgName}</p>
            </div>
          </div>
        )}
        {branding.logoUrl && (
          <div className="ml-1">
            <p className="text-xs text-gray-500 truncate max-w-[120px]">{orgName}</p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {NAV_ITEMS.map(item => <NavItem key={item.to} {...item} />)}
        {isManager && (
          <>
            <div className="pt-3 pb-1">
              <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Management</p>
            </div>
            {MANAGER_NAV.map(item => <NavItem key={item.to} {...item} />)}
          </>
        )}
        {canViewAnalytics && !isManager && (
          <>
            <div className="pt-3 pb-1">
              <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Insights</p>
            </div>
            {ANALYTICS_NAV.map(item => <NavItem key={item.to} {...item} />)}
          </>
        )}
        {canViewAnalytics && isManager && ANALYTICS_NAV.map(item => <NavItem key={item.to} {...item} />)}
        {(canRunPayroll || isAdmin) && (
          <>
            <div className="pt-3 pb-1">
              <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Admin</p>
            </div>
            {canRunPayroll && PAYROLL_NAV.map(item => <NavItem key={item.to} {...item} />)}
            {isAdmin && ADMIN_NAV.map(item => <NavItem key={item.to} {...item} />)}
          </>
        )}
      </nav>

      <div className="p-3 border-t border-gray-200">
        <NavLink to="/profile" className={({ isActive }) => clsx('sidebar-link', isActive && 'sidebar-link-active')}>
          <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: 'var(--color-primary)' }}>
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p>
            <p className="text-xs text-gray-500 truncate">{user?.role?.replace(/_/g, ' ')}</p>
          </div>
        </NavLink>
        <button onClick={handleLogout} className="sidebar-link w-full mt-1 text-red-600 hover:bg-red-50 hover:text-red-700">
          <ArrowLeftOnRectangleIcon className="h-5 w-5" />
          <span>Logout</span>
        </button>
      </div>

      {branding.footerText && (
        <div className="px-4 py-2 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center">{branding.footerText}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-gray-900/50" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-64 shadow-xl">
            <button onClick={() => setSidebarOpen(false)} className="absolute top-4 right-4 p-1 rounded text-gray-500 hover:bg-gray-100 z-10">
              <XMarkIcon className="h-5 w-5" />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <Bars3Icon className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <NavLink to="/notifications" className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100">
              {(notifData?.unreadCount || 0) > 0 ? (
                <>
                  <BellSolidIcon className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
                  <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                    {Math.min(notifData.unreadCount, 9)}
                  </span>
                </>
              ) : (
                <BellIcon className="h-5 w-5" />
              )}
            </NavLink>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
