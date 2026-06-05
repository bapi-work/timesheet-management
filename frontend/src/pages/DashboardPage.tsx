import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  UsersIcon, ClockIcon, CheckCircleIcon, ExclamationCircleIcon,
  ChartBarIcon, DocumentCheckIcon, ArrowRightIcon,
} from '@heroicons/react/24/outline';
import api from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import { format } from 'date-fns';
import { Line } from 'react-chartjs-2';
import { ANALYTICS_ROLES, hasRole } from '../lib/roles';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

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

export default function DashboardPage() {
  const { user } = useAuthStore();
  const canViewAnalytics = hasRole(user?.role, ANALYTICS_ROLES);

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: () => api.get('/analytics/dashboard').then(r => r.data),
  });

  const { data: trends } = useQuery({
    queryKey: ['analytics', 'trends'],
    queryFn: () => api.get('/analytics/trends').then(r => r.data),
    enabled: canViewAnalytics,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const chartData = trends ? {
    labels: trends.map((t: { month: string }) => t.month),
    datasets: [{
      label: 'Total Hours',
      data: trends.map((t: { hours: number }) => t.hours),
      borderColor: '#2563eb',
      backgroundColor: 'rgba(37,99,235,0.08)',
      tension: 0.4,
      fill: true,
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
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard label="Total Employees" value={dashboard?.totalEmployees || 0} icon={UsersIcon} color="bg-blue-500" />
            <StatCard label="Pending Approvals" value={dashboard?.pendingApprovals || 0} icon={CheckCircleIcon} color="bg-orange-500" />
            <StatCard label="Missing Timesheets" value={dashboard?.missingThisWeek || 0} icon={ExclamationCircleIcon} color="bg-red-500" sub="this week" />
            <StatCard label="Hours Logged" value={`${(dashboard?.totalHoursThisWeek || 0).toFixed(0)}h`} icon={ClockIcon} color="bg-green-500" sub="this week" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card">
              <h3 className="font-semibold text-gray-900 mb-4">Monthly Hours Trend</h3>
              {chartData && (
                <Line data={chartData} options={{
                  responsive: true,
                  plugins: { legend: { display: false } },
                  scales: { y: { beginAtZero: true } },
                }} />
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
                    <div className="h-2 w-2 rounded-full bg-red-500" />
                    <span className="text-sm text-gray-600">Missing</span>
                  </div>
                  <span className="font-semibold">{dashboard?.missingThisWeek || 0}</span>
                </div>
              </div>
              <Link to="/approvals" className="btn-primary w-full text-center mt-4">
                Review Pending <ArrowRightIcon className="h-4 w-4" />
              </Link>
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
            <StatCard label="Hours This Month" value={`${(dashboard?.hoursThisMonth || 0).toFixed(1)}h`} icon={ChartBarIcon} color="bg-purple-500" />
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
                    <th className="th">Hours</th>
                    <th className="th">Status</th>
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
                      <td className="td">
                        <span className={STATUS_BADGE[ts.status as string] || 'badge-gray'}>{ts.status as string}</span>
                      </td>
                      <td className="td">
                        <Link to={`/timesheets/${ts.id}`} className="text-primary-600 hover:underline text-xs">View</Link>
                      </td>
                    </tr>
                  ))}
                  {(!dashboard?.recentTimesheets?.length) && (
                    <tr><td colSpan={4} className="td text-center text-gray-400 py-8">No timesheets yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <Link to="/timesheets/current" className="btn-primary">
            <ClockIcon className="h-5 w-5" /> Open This Week's Timesheet
          </Link>
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
