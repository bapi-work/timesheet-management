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
import { ADMIN_ROLES, ANALYTICS_ROLES, MANAGEMENT_ROLES, PAYROLL_ROLES, hasRole } from './lib/roles';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
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
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/:id" element={<ClientDetailPage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="teams" element={<ManagerRoute><TeamsPage /></ManagerRoute>} />
          <Route path="departments" element={<AdminRoute><DepartmentsPage /></AdminRoute>} />
          <Route path="employees" element={<ManagerRoute><EmployeesPage /></ManagerRoute>} />
          <Route path="employees/:id" element={<ManagerRoute><EmployeeDetailPage /></ManagerRoute>} />
          <Route path="reports" element={<ManagerRoute><ReportsPage /></ManagerRoute>} />
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
