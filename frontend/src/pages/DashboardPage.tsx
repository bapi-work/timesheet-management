import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  UsersIcon, ClockIcon, CheckCircleIcon, ExclamationCircleIcon,
  ChartBarIcon, DocumentCheckIcon, ArrowRightIcon, CurrencyDollarIcon,
  AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/outline';
import api from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import { format, subMonths, startOfMonth, startOfYear } from 'date-fns';
import { Bar, Doughnut } from 'react-chartjs-2';
import { ANALYTICS_ROLES, ADMIN_ROLES, hasRole } from '../lib/roles';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler
);

type Period = 'month' | '3m' | '6m' | 'year' | 'all';

const PERIOD_OPTIONS: { value: Period; label: string; months: number }[] = [
  { value: 'month', label: 'This Month', months: 1 },
  { value: '3m', label: 'Last 3 Months', months: 3 },
  { value: '6m', label: 'Last 6 Months', months: 6 },
  { value: 'year', label: 'This Year', months: 12 },
  { value: 'all', label: 'All Time', months: 24 },
];

function getPeriodDates(period: Period): { from?: string; to?: string } {
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  if (period === 'all') return {};
  if (period === 'month') return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: today };
  if (period === '3m') return { from: format(subMonths(now, 3), 'yyyy-MM-dd'), to: today };
  if (period === '6m') return { from: format(subMonths(now, 6), 'yyyy-MM-dd'), to: today };
  if (period === 'year') return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: today };
  return {};
}

const DEFAULT_WIDGETS = { trend: true, employees: true, projects: true };

function loadWidgets() {
  try { return { ...DEFAULT_WIDGETS, ...JSON.parse(localStorage.getItem('dash_widgets') || '{}') }; }
  catch { return DEFAULT_WIDGETS; }
}

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
  DRAFT: 'badge-gray', SUBMITTED: 'badge-blue', APPROVED: 'badge-green',
  REJECTED: 'badge-red', LOCKED: 'badge-purple', NOT_STARTED: 'badge-yellow',
};

const CHART_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed',
  '#0891b2', '#db2777', '#059669', '#ea580c', '#4f46e5',
];

export default function DashboardPage() {
  const { user } = useAuthStore();
  const canViewAnalytics = hasRole(user?.role, ANALYTICS_ROLES);
  const isAdminOrHR = hasRole(user?.role, ADMIN_ROLES);

  const [period, setPeriod] = useState<Period>('6m');
  const [departmentId, setDepartmentId] = useState('');
  const [widgets, setWidgets] = useState<Record<string, boolean>>(loadWidgets);
  const [showCustomize, setShowCustomize] = useState(false);

  const periodConfig = PERIOD_OPTIONS.find(p => p.value === period)!;
  const { from, to } = getPeriodDates(period);

  useEffect(() => {
    localStorage.setItem('dash_widgets', JSON.stringify(widgets));
  }, [widgets]);

  const { data: departments = [] } = useQuery({
    queryKey: ['departments-list'],
    queryFn: () => api.get('/departments').then(r => Array.isArray(r.data) ? r.data : (r.data.departments || [])),
    enabled: isAdminOrHR,
  });

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: () => api.get('/analytics/dashboard').then(r => r.data),
  });

  const trendParams = new URLSearchParams({ months: String(periodConfig.months) });
  if (departmentId) trendParams.set('departmentId', departmentId);

  const { data: trends } = useQuery({
    queryKey: ['analytics', 'trends', periodConfig.months, departmentId],
    queryFn: () => api.get(`/analytics/trends?${trendParams}`).then(r => r.data),
    enabled: canViewAnalytics && widgets.trend,
  });

  const empParams = new URLSearchParams({ limit: '10' });
  if (from) empParams.set('from', from);
  if (to) empParams.set('to', to);
  if (departmentId) empParams.set('departmentId', departmentId);

  const { data: billableByEmployee } = useQuery({
    queryKey: ['analytics', 'billable-by-employee', from, to, departmentId],
    queryFn: () => api.get(`/analytics/billable-by-employee?${empParams}`).then(r => r.data),
    enabled: isAdminOrHR && widgets.employees,
  });

  const projParams = new URLSearchParams({ limit: '10' });
  if (from) projParams.set('from', from);
  if (to) projParams.set('to', to);

  const { data: billableByProject } = useQuery({
    queryKey: ['analytics', 'billable-by-project', from, to],
    queryFn: () => api.get(`/analytics/billable-by-project?${projParams}`).then(r => r.data),
    enabled: isAdminOrHR && widgets.projects,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const monthlyChartData = trends?.length ? {
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

  const toggleWidget = (key: string) => setWidgets(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Good {getGreeting()}, {user?.firstName}!
          </h1>
          <p className="text-gray-500 text-sm mt-1">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
        </div>

        {canViewAnalytics && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Department filter */}
            {isAdminOrHR && (departments as Record<string, unknown>[]).length > 0 && (
              <select
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Departments</option>
                {(departments as Record<string, unknown>[]).map((d) => (
                  <option key={d.id as string} value={d.id as string}>{d.name as string}</option>
                ))}
              </select>
            )}

            {/* Period filter */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white">
              {PERIOD_OPTIONS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    period === p.value
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Customize */}
            <div className="relative">
              <button
                onClick={() => setShowCustomize(v => !v)}
                className="btn-secondary btn-sm flex items-center gap-1.5"
              >
                <AdjustmentsHorizontalIcon className="h-4 w-4" /> Customize
              </button>
              {showCustomize && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-20 w-48 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Widgets</p>
                  {[
                    { key: 'trend', label: 'Monthly Trend Chart' },
                    { key: 'employees', label: 'Employees Chart' },
                    { key: 'projects', label: 'Projects Chart' },
                  ].map(w => (
                    <label key={w.key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!widgets[w.key]}
                        onChange={() => toggleWidget(w.key)}
                        className="rounded border-gray-300 text-primary-600"
                      />
                      <span className="text-sm text-gray-700">{w.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {canViewAnalytics ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              label="Billable Hours"
              value={`${((dashboard?.billableHoursThisMonth || 0)).toFixed(2)}h`}
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

          {/* Monthly Trend Chart */}
          {widgets.trend && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">Total vs Billable Hours — {periodConfig.label}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {departmentId ? (departments as Record<string, unknown>[]).find(d => d.id === departmentId)?.name as string : 'All departments'}
                  </p>
                </div>
                <span className="text-sm font-semibold text-green-600">
                  All-time: {((dashboard?.totalBillableHoursAllTime || 0)).toFixed(2)}h billable
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
                <p className="text-gray-400 text-center py-8">No data for this period</p>
              )}
            </div>
          )}

          {/* Employee + This Week Summary */}
          {widgets.employees && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 card">
                <h3 className="font-semibold text-gray-900 mb-1">Billable Hours by Employee (Top 10)</h3>
                <p className="text-xs text-gray-400 mb-4">{periodConfig.label}{departmentId ? ` · ${(departments as Record<string, unknown>[]).find(d => d.id === departmentId)?.name as string}` : ''}</p>
                {employeeChartData ? (
                  <Bar
                    data={employeeChartData}
                    options={{
                      responsive: true,
                      indexAxis: 'y' as const,
                      plugins: { legend: { display: false } },
                      scales: { x: { beginAtZero: true, title: { display: true, text: 'Hours' } } },
                    }}
                  />
                ) : (
                  <p className="text-gray-400 text-center py-8">No billable hours in this period</p>
                )}
              </div>

              <div className="card space-y-4">
                <h3 className="font-semibold text-gray-900">This Week</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Submitted', color: 'bg-blue-500', value: dashboard?.submittedThisWeek || 0 },
                    { label: 'Approved', color: 'bg-green-500', value: dashboard?.approvedThisWeek || 0 },
                    { label: 'Hours Logged', color: 'bg-orange-500', value: `${(dashboard?.totalHoursThisWeek || 0).toFixed(2)}h` },
                    { label: 'Missing', color: 'bg-red-500', value: dashboard?.missingThisWeek || 0 },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${item.color}`} />
                        <span className="text-sm text-gray-600">{item.label}</span>
                      </div>
                      <span className="font-semibold">{item.value}</span>
                    </div>
                  ))}
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
          )}

          {/* Projects Chart */}
          {widgets.projects && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-1">Billable Hours by Project (Top 10)</h3>
                <p className="text-xs text-gray-400 mb-4">{periodConfig.label}</p>
                {projectChartData ? (
                  <Doughnut
                    data={projectChartData}
                    options={{
                      responsive: true,
                      plugins: {
                        legend: { position: 'right' },
                        tooltip: {
                          callbacks: {
                            label: ctx => ` ${ctx.label}: ${(ctx.raw as number).toFixed(2)}h`,
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
                          <td className="td font-semibold text-green-600">{(p.billableHours as number).toFixed(2)}h</td>
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
          )}

          {/* All widgets hidden notice */}
          {!widgets.trend && !widgets.employees && !widgets.projects && (
            <div className="card text-center py-12">
              <AdjustmentsHorizontalIcon className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">All widgets are hidden. Click <strong>Customize</strong> to show them.</p>
            </div>
          )}
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
            <StatCard label="Hours This Week" value={`${(dashboard?.hoursThisWeek || 0).toFixed(2)}h`} icon={ClockIcon} color="bg-blue-500" />
            <StatCard label="Billable This Week" value={`${(dashboard?.billableHoursThisWeek || 0).toFixed(2)}h`} icon={CurrencyDollarIcon} color="bg-green-500" />
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
                      <td className="td">{(ts.totalHours as number).toFixed(2)}h</td>
                      <td className="td text-green-600">{((ts.billableHours as number) || 0).toFixed(2)}h</td>
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
