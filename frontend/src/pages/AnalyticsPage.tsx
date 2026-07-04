import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subMonths, startOfMonth, startOfYear, subYears } from 'date-fns';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale,
  Tooltip, Legend, LineElement, PointElement, Title, Filler,
} from 'chart.js';
import api from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import { ADMIN_ROLES, hasRole } from '../lib/roles';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend, LineElement, PointElement, Title, Filler);

type Period = 'month' | '3m' | '6m' | 'year' | '2y' | 'all';

const PERIOD_OPTIONS: { value: Period; label: string; months: number }[] = [
  { value: 'month', label: 'This Month', months: 1 },
  { value: '3m', label: '3 Months', months: 3 },
  { value: '6m', label: '6 Months', months: 6 },
  { value: 'year', label: 'This Year', months: 12 },
  { value: '2y', label: '2 Years', months: 24 },
  { value: 'all', label: 'All Time', months: 0 },
];

function getPeriodDates(period: Period): { from?: string; to?: string; months?: number } {
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  if (period === 'all') return { months: 24 };
  if (period === 'month') return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: today, months: 1 };
  if (period === '3m') return { from: format(subMonths(now, 3), 'yyyy-MM-dd'), to: today, months: 3 };
  if (period === '6m') return { from: format(subMonths(now, 6), 'yyyy-MM-dd'), to: today, months: 6 };
  if (period === 'year') return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: today, months: 12 };
  if (period === '2y') return { from: format(subYears(now, 2), 'yyyy-MM-dd'), to: today, months: 24 };
  return { months: 12 };
}

const CHART_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed',
  '#0891b2', '#db2777', '#059669', '#ea580c', '#4f46e5',
];

function exportCSV(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function AnalyticsPage() {
  const { user } = useAuthStore();
  const isAdminOrHR = hasRole(user?.role, ADMIN_ROLES);

  const [period, setPeriod] = useState<Period>('6m');
  const [departmentId, setDepartmentId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [useCustomRange, setUseCustomRange] = useState(false);

  const periodConfig = PERIOD_OPTIONS.find(p => p.value === period)!;
  const { from: periodFrom, to: periodTo, months } = getPeriodDates(period);
  const from = useCustomRange ? customFrom : periodFrom;
  const to = useCustomRange ? customTo : periodTo;
  const trendMonths = useCustomRange ? 12 : (months || 12);

  // Departments
  const { data: departments = [] } = useQuery({
    queryKey: ['departments-list'],
    queryFn: () => api.get('/departments').then(r => Array.isArray(r.data) ? r.data : (r.data.departments || [])),
    enabled: isAdminOrHR,
  });

  // Employees
  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users?limit=200').then(r => r.data),
    enabled: isAdminOrHR,
  });
  const allEmployees: Record<string, unknown>[] = usersData?.users || [];
  const filteredEmployees = departmentId
    ? allEmployees.filter(u => (u.department as { id: string } | null)?.id === departmentId)
    : allEmployees;

  // Trend chart
  const trendParams = new URLSearchParams({ months: String(trendMonths) });
  if (departmentId) trendParams.set('departmentId', departmentId);
  if (from) trendParams.set('from', from);
  if (to) trendParams.set('to', to);

  const { data: trends = [] } = useQuery({
    queryKey: ['analytics', 'trends', trendMonths, departmentId, from, to],
    queryFn: () => api.get(`/analytics/trends?${trendParams}`).then(r => r.data),
  });

  // Billable by employee
  const empParams = new URLSearchParams({ limit: '20' });
  if (from) empParams.set('from', from);
  if (to) empParams.set('to', to);
  if (departmentId) empParams.set('departmentId', departmentId);

  const { data: billableByEmployee = [] } = useQuery({
    queryKey: ['analytics', 'billable-by-employee', from, to, departmentId],
    queryFn: () => api.get(`/analytics/billable-by-employee?${empParams}`).then(r => r.data),
    enabled: isAdminOrHR,
  });

  // Billable by project
  const projParams = new URLSearchParams({ limit: '15' });
  if (from) projParams.set('from', from);
  if (to) projParams.set('to', to);

  const { data: billableByProject = [] } = useQuery({
    queryKey: ['analytics', 'billable-by-project', from, to],
    queryFn: () => api.get(`/analytics/billable-by-project?${projParams}`).then(r => r.data),
    enabled: isAdminOrHR,
  });

  // Utilization report
  const utilParams = new URLSearchParams();
  if (from) utilParams.set('from', from);
  if (to) utilParams.set('to', to);
  if (departmentId) utilParams.set('departmentId', departmentId);

  const { data: utilization = [] } = useQuery({
    queryKey: ['reports', 'utilization', from, to, departmentId],
    queryFn: () => api.get(`/reports/utilization?${utilParams}`).then(r => r.data),
    enabled: isAdminOrHR,
  });

  // Filter by selected employee if set
  const empUtil = employeeId
    ? (utilization as Record<string, unknown>[]).filter(u => u.id === employeeId)
    : (utilization as Record<string, unknown>[]);

  const displayEmployees = (billableByEmployee as Record<string, unknown>[]).filter(e =>
    !employeeId || e.id === employeeId
  );

  // Chart data
  const trendChartData = (trends as { month: string; hours: number; billableHours: number }[]).length ? {
    labels: (trends as { month: string }[]).map(t => t.month),
    datasets: [
      {
        label: 'Total Hours',
        data: (trends as { hours: number }[]).map(t => t.hours),
        backgroundColor: 'rgba(37,99,235,0.6)',
        borderColor: '#2563eb',
        borderWidth: 1,
      },
      {
        label: 'Billable Hours',
        data: (trends as { billableHours: number }[]).map(t => t.billableHours),
        backgroundColor: 'rgba(22,163,74,0.6)',
        borderColor: '#16a34a',
        borderWidth: 1,
      },
    ],
  } : null;

  const employeeChartData = displayEmployees.length ? {
    labels: displayEmployees.map(e => e.name as string),
    datasets: [{
      label: 'Billable Hours',
      data: displayEmployees.map(e => e.billableHours as number),
      backgroundColor: CHART_COLORS,
      borderWidth: 1,
    }],
  } : null;

  const projectChartData = (billableByProject as Record<string, unknown>[]).length ? {
    labels: (billableByProject as { name: string }[]).map(p => p.name),
    datasets: [{
      data: (billableByProject as { billableHours: number }[]).map(p => p.billableHours),
      backgroundColor: CHART_COLORS,
    }],
  } : null;

  const totalHoursLogged = (utilization as { totalHours: number }[]).reduce((s, u) => s + u.totalHours, 0);
  const totalBillable = (utilization as { billableHours: number }[]).reduce((s, u) => s + u.billableHours, 0);
  const avgUtil = totalHoursLogged > 0 ? Math.round((totalBillable / totalHoursLogged) * 100) : 0;

  const handleExportEmployees = () => {
    const rows = [
      ['Employee', 'Employee ID', 'Department', 'Total Hours', 'Billable Hours', 'Non-Billable', 'Utilization %'],
      ...(utilization as Record<string, unknown>[]).map(u => [
        `${u.firstName} ${u.lastName}`,
        (u.employeeId as string) || '',
        (u.department as { name: string } | null)?.name || '',
        String((u.totalHours as number).toFixed(2)),
        String((u.billableHours as number).toFixed(2)),
        String((u.nonBillableHours as number).toFixed(2)),
        String(u.utilizationPct),
      ]),
    ];
    exportCSV(rows, `analytics-employees-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  const handleExportProjects = () => {
    const rows = [
      ['Project', 'Code', 'Client', 'Budget Hours', 'Billable Hours'],
      ...(billableByProject as Record<string, unknown>[]).map(p => [
        p.name as string,
        (p.code as string) || '',
        (p.clientName as string) || '',
        String(p.budgetHours || ''),
        String((p.billableHours as number).toFixed(2)),
      ]),
    ];
    exportCSV(rows, `analytics-projects-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Period pills */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Period</label>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden bg-white">
              {PERIOD_OPTIONS.map(p => (
                <button
                  key={p.value}
                  onClick={() => { setPeriod(p.value); setUseCustomRange(false); }}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    !useCustomRange && period === p.value ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => setUseCustomRange(true)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  useCustomRange ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Custom
              </button>
            </div>
          </div>

          {/* Custom range */}
          {useCustomRange && (
            <div className="flex items-center gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">From</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">To</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input" />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          {/* Department filter */}
          {isAdminOrHR && (departments as Record<string, unknown>[]).length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Department</label>
              <select
                value={departmentId}
                onChange={e => { setDepartmentId(e.target.value); setEmployeeId(''); }}
                className="input"
              >
                <option value="">All Departments</option>
                {(departments as { id: string; name: string }[]).map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Employee filter */}
          {isAdminOrHR && filteredEmployees.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Employee</label>
              <select
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
                className="input"
              >
                <option value="">All Employees</option>
                {filteredEmployees.map(u => (
                  <option key={u.id as string} value={u.id as string}>
                    {u.firstName as string} {u.lastName as string}
                    {u.employeeId ? ` (${u.employeeId})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Active filter summary */}
        {(departmentId || employeeId || useCustomRange) && (
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="text-xs text-gray-500">Filtered by:</span>
            {departmentId && (
              <span className="badge-blue text-xs">
                Dept: {(departments as { id: string; name: string }[]).find(d => d.id === departmentId)?.name}
                <button onClick={() => { setDepartmentId(''); setEmployeeId(''); }} className="ml-1 hover:text-blue-800">×</button>
              </span>
            )}
            {employeeId && (
              <span className="badge-blue text-xs">
                Employee: {filteredEmployees.find(u => u.id === employeeId)?.firstName as string} {filteredEmployees.find(u => u.id === employeeId)?.lastName as string}
                <button onClick={() => setEmployeeId('')} className="ml-1 hover:text-blue-800">×</button>
              </span>
            )}
            {useCustomRange && (customFrom || customTo) && (
              <span className="badge-blue text-xs">
                {customFrom || '…'} → {customTo || '…'}
                <button onClick={() => { setUseCustomRange(false); setCustomFrom(''); setCustomTo(''); }} className="ml-1 hover:text-blue-800">×</button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* KPI Summary */}
      {isAdminOrHR && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Hours Logged', value: totalHoursLogged.toFixed(0) + 'h', color: 'bg-blue-500' },
            { label: 'Total Billable Hours', value: totalBillable.toFixed(0) + 'h', color: 'bg-green-500' },
            { label: 'Non-Billable Hours', value: (totalHoursLogged - totalBillable).toFixed(0) + 'h', color: 'bg-orange-500' },
            { label: 'Avg Billable Rate', value: avgUtil + '%', color: 'bg-purple-500' },
          ].map(card => (
            <div key={card.label} className="card">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg ${card.color} flex-shrink-0`} />
                <div>
                  <p className="text-xs text-gray-500">{card.label}</p>
                  <p className="text-xl font-bold text-gray-900">{card.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Monthly Trend */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-1">
          Monthly Hours Trend
          {departmentId && <span className="ml-2 text-sm font-normal text-gray-500">— {(departments as { id: string; name: string }[]).find(d => d.id === departmentId)?.name}</span>}
        </h3>
        <p className="text-xs text-gray-400 mb-4">{useCustomRange ? `${customFrom || '…'} to ${customTo || '…'}` : periodConfig.label}</p>
        {trendChartData ? (
          <Bar
            data={trendChartData}
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
          <p className="text-gray-400 text-center py-10">No data for this period</p>
        )}
      </div>

      {/* Employee + Project charts */}
      {isAdminOrHR && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Billable by Employee */}
          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-gray-900">Billable Hours by Employee</h3>
              <button onClick={handleExportEmployees} title="Export CSV" className="text-gray-400 hover:text-primary-600">
                <ArrowDownTrayIcon className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">{useCustomRange ? `${customFrom || '…'} to ${customTo || '…'}` : periodConfig.label}</p>
            {employeeChartData ? (
              <Bar
                data={employeeChartData}
                options={{
                  responsive: true,
                  indexAxis: 'y' as const,
                  plugins: { legend: { display: false } },
                  scales: { x: { beginAtZero: true } },
                }}
              />
            ) : (
              <p className="text-gray-400 text-center py-10">No billable hours in this period</p>
            )}
          </div>

          {/* Billable by Project */}
          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-gray-900">Billable Hours by Project</h3>
              <button onClick={handleExportProjects} title="Export CSV" className="text-gray-400 hover:text-primary-600">
                <ArrowDownTrayIcon className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">{useCustomRange ? `${customFrom || '…'} to ${customTo || '…'}` : periodConfig.label}</p>
            {projectChartData ? (
              <Doughnut
                data={projectChartData}
                options={{
                  responsive: true,
                  plugins: {
                    legend: { position: 'right' },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${(ctx.raw as number).toFixed(2)}h` } },
                  },
                }}
              />
            ) : (
              <p className="text-gray-400 text-center py-10">No billable project data</p>
            )}
          </div>
        </div>
      )}

      {/* Employee Utilization Table */}
      {isAdminOrHR && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              Employee Utilization
              {employeeId && <span className="ml-2 text-sm font-normal text-gray-500">— filtered</span>}
            </h3>
            <button onClick={handleExportEmployees} className="btn-secondary btn-sm flex items-center gap-1.5">
              <ArrowDownTrayIcon className="h-4 w-4" /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">Employee</th>
                  <th className="th">Department</th>
                  <th className="th">Total Hours</th>
                  <th className="th">Billable</th>
                  <th className="th">Non-Billable</th>
                  <th className="th">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {empUtil.length === 0 ? (
                  <tr><td colSpan={6} className="td text-center text-gray-400 py-8">No data</td></tr>
                ) : empUtil.map((u: Record<string, unknown>) => {
                  const pct = u.utilizationPct as number;
                  return (
                    <tr key={u.id as string} className="tr-hover">
                      <td className="td">
                        <span className="font-medium">{u.firstName as string} {u.lastName as string}</span>
                        {(u.employeeId as string | null) && <span className="ml-1 text-xs text-gray-400">({u.employeeId as string})</span>}
                      </td>
                      <td className="td text-gray-500 text-sm">{(u.department as { name: string } | null)?.name || '—'}</td>
                      <td className="td">{(u.totalHours as number).toFixed(2)}h</td>
                      <td className="td text-green-600">{(u.billableHours as number).toFixed(2)}h</td>
                      <td className="td text-gray-500">{(u.nonBillableHours as number).toFixed(2)}h</td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-20">
                            <div
                              className={`h-full rounded-full ${pct >= 75 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-400'}`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className={`text-sm font-semibold ${pct >= 75 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Project Breakdown Table */}
      {isAdminOrHR && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Project Billable Breakdown</h3>
            <button onClick={handleExportProjects} className="btn-secondary btn-sm flex items-center gap-1.5">
              <ArrowDownTrayIcon className="h-4 w-4" /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="th">Project</th>
                  <th className="th">Client</th>
                  <th className="th">Budget</th>
                  <th className="th">Billable Hours</th>
                  <th className="th">Budget Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {(billableByProject as Record<string, unknown>[]).length === 0 ? (
                  <tr><td colSpan={5} className="td text-center text-gray-400 py-8">No project data</td></tr>
                ) : (billableByProject as Record<string, unknown>[]).map((p, i) => {
                  const budget = p.budgetHours as number | null;
                  const billable = p.billableHours as number;
                  const budgetPct = budget ? Math.round((billable / budget) * 100) : null;
                  return (
                    <tr key={i} className="tr-hover">
                      <td className="td">
                        <span className="font-medium">{p.name as string}</span>
                        {(p.code as string | null) && <span className="ml-1 text-xs text-gray-400">({p.code as string})</span>}
                      </td>
                      <td className="td text-gray-500">{(p.clientName as string) || '—'}</td>
                      <td className="td text-gray-500">{budget ? `${budget}h` : '—'}</td>
                      <td className="td font-semibold text-green-600">{billable.toFixed(2)}h</td>
                      <td className="td">
                        {budgetPct !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-20">
                              <div
                                className={`h-full rounded-full ${budgetPct >= 90 ? 'bg-red-500' : budgetPct >= 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                style={{ width: `${Math.min(budgetPct, 100)}%` }}
                              />
                            </div>
                            <span className={`text-sm font-semibold ${budgetPct >= 90 ? 'text-red-600' : budgetPct >= 70 ? 'text-yellow-600' : 'text-green-600'}`}>{budgetPct}%</span>
                          </div>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
