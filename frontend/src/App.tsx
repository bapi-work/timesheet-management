import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth.store';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import TimesheetPage from './pages/TimesheetPage';
import TimesheetListPage from './pages/TimesheetListPage';
import ApprovalsPage from './pages/ApprovalsPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import EmployeesPage from './pages/EmployeesPage';
import EmployeeDetailPage from './pages/EmployeeDetailPage';
import AttendancePage from './pages/AttendancePage';
import LeavePage from './pages/LeavePage';
import ReportsPage from './pages/ReportsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import PayrollPage from './pages/PayrollPage';
import NotificationsPage from './pages/NotificationsPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import NotFoundPage from './pages/NotFoundPage';
import CalendarPage from './pages/CalendarPage';
import ExpensesPage from './pages/ExpensesPage';
import InvoicesPage from './pages/InvoicesPage';
import BackupPage from './pages/BackupPage';
import TeamsPage from './pages/TeamsPage';
import DepartmentsPage from './pages/DepartmentsPage';
import { SYSTEM_ADMIN_ROLES, ADMIN_ROLES, ANALYTICS_ROLES, MANAGEMENT_ROLES, SENIOR_MANAGER_ROLES, PAYROLL_ROLES, hasRole } from './lib/roles';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole(user.role, SYSTEM_ADMIN_ROLES)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function HrRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole(user.role, ADMIN_ROLES)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function ManagerRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole(user.role, MANAGEMENT_ROLES)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SeniorManagerRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole(user.role, SENIOR_MANAGER_ROLES)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AnalyticsRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole(user.role, ANALYTICS_ROLES)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PayrollRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!hasRole(user.role, PAYROLL_ROLES)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="timesheets" element={<TimesheetListPage />} />
          <Route path="timesheets/current" element={<TimesheetPage />} />
          <Route path="timesheets/:id" element={<TimesheetPage />} />
          <Route path="approvals" element={<ManagerRoute><ApprovalsPage /></ManagerRoute>} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="clients" element={<SeniorManagerRoute><ClientsPage /></SeniorManagerRoute>} />
          <Route path="clients/:id" element={<SeniorManagerRoute><ClientDetailPage /></SeniorManagerRoute>} />
          <Route path="attendance" element={<HrRoute><AttendancePage /></HrRoute>} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="invoices" element={<SeniorManagerRoute><InvoicesPage /></SeniorManagerRoute>} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="teams" element={<SeniorManagerRoute><TeamsPage /></SeniorManagerRoute>} />
          <Route path="departments" element={<HrRoute><DepartmentsPage /></HrRoute>} />
          <Route path="employees" element={<SeniorManagerRoute><EmployeesPage /></SeniorManagerRoute>} />
          <Route path="employees/:id" element={<SeniorManagerRoute><EmployeeDetailPage /></SeniorManagerRoute>} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="analytics" element={<AnalyticsRoute><AnalyticsPage /></AnalyticsRoute>} />
          <Route path="payroll" element={<PayrollRoute><PayrollPage /></PayrollRoute>} />
          <Route path="admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
          <Route path="backup" element={<AdminRoute><BackupPage /></AdminRoute>} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
