import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  UsersIcon, ClockIcon, CheckCircleIcon, ExclamationCircleIcon,
  ChartBarIcon, DocumentCheckIcon, ArrowRightIcon, CurrencyDollarIcon,
} from '@heroicons/react/24/outline';
import api from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import { format } from 'date-fns';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { ANALYTICS_ROLES, ADMIN_ROLES, hasRole } from '../lib/roles';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler
);

function StatCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string | number; icon: React.ElementType; color: string; sub?: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
        </div>
        <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray',
  SUBMITTED: 'badge-blue',
  APPROVED: 'badge-green',
  REJECTED: 'badge-red',
  LOCKED: 'badge-purple',
  NOT_STARTED: 'badge-yellow',
};

const CHART_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed',
  '#0891b2', '#db2777', '#059669', '#ea580c', '#4f46e5',
];

export default function DashboardPage() {
  const { user } = useAuthStore();
  const canViewAnalytics = hasRole(user?.role, ANALYTICS_ROLES);
  const isAdminOrHR = hasRole(user?.role, ADMIN_ROLES);

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: () => api.get('/analytics/dashboard').then(r => r.data),
  });

  const { data: trends } = useQuery({
    queryKey: ['analytics', 'trends', '12'],
    queryFn: () => api.get('/analytics/trends?months=12').then(r => r.data),
    enabled: canViewAnalytics,
  });

  const { data: billableByEmployee } = useQuery({
    queryKey: ['analytics', 'billable-by-employee'],
    queryFn: () => api.get('/analytics/billable-by-employee?limit=10').then(r => r.data),
    enabled: isAdminOrHR,
  });

  const { data: billableByProject } = useQuery({
    queryKey: ['analytics', 'billable-by-project'],
    queryFn: () => api.get('/analytics/billable-by-project?limit=10').then(r => r.data),
    enabled: isAdminOrHR,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const monthlyChartData = trends ? {
    labels: trends.map((t: { month: string }) => t.month),
    datasets: [
      {
        label: 'Total Hours',
        data: trends.map((t: { hours: number }) => t.hours),
        backgroundColor: 'rgba(37,99,235,0.7)',
        borderColor: '#2563eb',
        borderWidth: 1,
      },
      {
        label: 'Billable Hours',
        data: trends.map((t: { billableHours: number }) => t.billableHours),
        backgroundColor: 'rgba(22,163,74,0.7)',
        borderColor: '#16a34a',
        borderWidth: 1,
      },
    ],
  } : null;

  const employeeChartData = billableByEmployee?.length ? {
    labels: billableByEmployee.map((e: { name: string }) => e.name),
    datasets: [{
      label: 'Billable Hours',
      data: billableByEmployee.map((e: { billableHours: number }) => e.billableHours),
      backgroundColor: CHART_COLORS,
      borderWidth: 1,
    }],
  } : null;

  const projectChartData = billableByProject?.length ? {
    labels: billableByProject.map((p: { name: string }) => p.name),
    datasets: [{
      data: billableByProject.map((p: { billableHours: number }) => p.billableHours),
      backgroundColor: CHART_COLORS,
    }],
  } : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Good {getGreeting()}, {user?.firstName}!
        </h1>
        <p className="text-gray-500 text-sm mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
      </div>

      {canViewAnalytics ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              label="Total Billable Hours"
              value={`${((dashboard?.billableHoursThisMonth || 0)).toFixed(0)}h`}
              icon={CurrencyDollarIcon}
              color="bg-green-500"
              sub="this month"
            />
            <StatCard
              label="Total Employees"
              value={dashboard?.totalEmployees || 0}
              icon={UsersIcon}
              color="bg-blue-500"
            />
            <StatCard
              label="Pending Approvals"
              value={dashboard?.pendingApprovals || 0}
              icon={CheckCircleIcon}
              color="bg-orange-500"
            />
            <StatCard
              label="Missing Timesheets"
              value={dashboard?.missingThisWeek || 0}
              icon={ExclamationCircleIcon}
              color="bg-red-500"
              sub="this week"
            />
          </div>

          {/* Monthly Billable Hours Chart */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Total Billable Hours by Month</h3>
                <p className="text-xs text-gray-400 mt-0.5">Last 12 months — total vs billable</p>
              </div>
              <span className="text-sm font-semibold text-green-600">
                All-time: {((dashboard?.totalBillableHoursAllTime || 0)).toFixed(0)}h billable
              </span>
            </div>
            {monthlyChartData ? (
              <Bar
                data={monthlyChartData}
                options={{
                  responsive: true,
                  plugins: {
                    legend: { position: 'top' },
                    tooltip: { mode: 'index', intersect: false },
                  },
                  scales: { y: { beginAtZero: true, title: { display: true, text: 'Hours' } } },
                }}
              />
            ) : (
              <p className="text-gray-400 text-center py-8">No data available</p>
            )}
          </div>

          {/* Billable Hours by Employee + This Week Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card">
              <h3 className="font-semibold text-gray-900 mb-4">Billable Hours by Employee (Top 10)</h3>
              {employeeChartData ? (
                <Bar
                  data={employeeChartData}
                  options={{
                    responsive: true,
                    indexAxis: 'y',
                    plugins: { legend: { display: false } },
                    scales: { x: { beginAtZero: true, title: { display: true, text: 'Hours' } } },
                  }}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th className="th">Employee</th><th className="th">Department</th><th className="th">Billable Hrs</th><th className="th">Total Hrs</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {(billableByEmployee || []).map((e: Record<string, unknown>, i: number) => (
                        <tr key={i} className="tr-hover">
                          <td className="td font-medium">{e.name as string}</td>
                          <td className="td text-gray-500">{(e.department as Record<string, unknown>)?.name as string || '—'}</td>
                          <td className="td text-green-600 font-semibold">{(e.billableHours as number).toFixed(1)}h</td>
                          <td className="td text-gray-500">{(e.totalHours as number).toFixed(1)}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card space-y-4">
              <h3 className="font-semibold text-gray-900">This Week</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-blue-500" />
                    <span className="text-sm text-gray-600">Submitted</span>
                  </div>
                  <span className="font-semibold">{dashboard?.submittedThisWeek || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="text-sm text-gray-600">Approved</span>
                  </div>
                  <span className="font-semibold">{dashboard?.approvedThisWeek || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-orange-500" />
                    <span className="text-sm text-gray-600">Hours Logged</span>
                  </div>
                  <span className="font-semibold">{(dashboard?.totalHoursThisWeek || 0).toFixed(0)}h</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-red-500" />
                    <span className="text-sm text-gray-600">Missing</span>
                  </div>
                  <span className="font-semibold">{dashboard?.missingThisWeek || 0}</span>
                </div>
              </div>
              <div className="pt-2 space-y-2">
                <Link to="/approvals" className="btn-primary w-full text-center">
                  Review Pending <ArrowRightIcon className="h-4 w-4" />
                </Link>
                <Link to="/reports" className="btn-secondary w-full text-center">
                  <ChartBarIcon className="h-4 w-4" /> View Reports
                </Link>
              </div>
            </div>
          </div>

          {/* Billable Hours by Projects */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-4">Total Billable Hours by Projects (Top 10)</h3>
              {projectChartData ? (
                <Doughnut
                  data={projectChartData}
                  options={{
                    responsive: true,
                    plugins: {
                      legend: { position: 'right' },
                      tooltip: {
                        callbacks: {
                          label: ctx => ` ${ctx.label}: ${(ctx.raw as number).toFixed(1)}h`,
                        },
                      },
                    },
                  }}
                />
              ) : (
                <p className="text-gray-400 text-center py-8">No billable project data</p>
              )}
            </div>

            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-4">Project Billable Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="th">Project</th>
                      <th className="th">Client</th>
                      <th className="th">Billable Hrs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(billableByProject || []).map((p: Record<string, unknown>, i: number) => (
                      <tr key={i} className="tr-hover">
                        <td className="td">
                          <span className="font-medium">{p.name as string}</span>
                          {p.code ? <span className="ml-1 text-xs text-gray-400">({p.code as string})</span> : null}
                        </td>
                        <td className="td text-gray-500">{(p.clientName as string) || '—'}</td>
                        <td className="td font-semibold text-green-600">{(p.billableHours as number).toFixed(1)}h</td>
                      </tr>
                    ))}
                    {!billableByProject?.length && (
                      <tr><td colSpan={3} className="td text-center text-gray-400 py-6">No project data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Current Timesheet"
              value={dashboard?.currentTimesheetStatus?.replace(/_/g, ' ') || 'NOT STARTED'}
              icon={DocumentCheckIcon}
              color={dashboard?.currentTimesheetStatus === 'APPROVED' ? 'bg-green-500' : 'bg-orange-500'}
            />
            <StatCard label="Hours This Week" value={`${(dashboard?.hoursThisWeek || 0).toFixed(1)}h`} icon={ClockIcon} color="bg-blue-500" />
            <StatCard label="Billable This Week" value={`${(dashboard?.billableHoursThisWeek || 0).toFixed(1)}h`} icon={CurrencyDollarIcon} color="bg-green-500" />
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Recent Timesheets</h3>
              <Link to="/timesheets" className="text-sm text-primary-600 hover:underline">View all</Link>
            </div>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th className="th">Period</th>
                    <th className="th">Total Hrs</th>
                    <th className="th">Billable</th>
                    <th className="th">Status</th>
                    <th className="th">Submitted</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(dashboard?.recentTimesheets || []).map((ts: Record<string, unknown>) => (
                    <tr key={ts.id as string} className="tr-hover">
                      <td className="td">
                        {format(new Date(ts.periodStart as string), 'MMM d')} – {format(new Date(ts.periodEnd as string), 'MMM d, yyyy')}
                      </td>
                      <td className="td">{(ts.totalHours as number).toFixed(1)}h</td>
                      <td className="td text-green-600">{((ts.billableHours as number) || 0).toFixed(1)}h</td>
                      <td className="td">
                        <span className={STATUS_BADGE[ts.status as string] || 'badge-gray'}>{ts.status as string}</span>
                      </td>
                      <td className="td text-xs text-gray-400">
                        {ts.submittedAt ? format(new Date(ts.submittedAt as string), 'MMM d') : '—'}
                      </td>
                      <td className="td">
                        <Link to={`/timesheets/${ts.id}`} className="text-primary-600 hover:underline text-xs">View</Link>
                      </td>
                    </tr>
                  ))}
                  {(!dashboard?.recentTimesheets?.length) && (
                    <tr><td colSpan={6} className="td text-center text-gray-400 py-8">No timesheets yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            <Link to="/timesheets/current" className="btn-primary">
              <ClockIcon className="h-5 w-5" /> Open This Week's Timesheet
            </Link>
            <Link to="/timesheets" className="btn-secondary">
              View All Timesheets
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
