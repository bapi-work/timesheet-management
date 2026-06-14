import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { ArrowDownTrayIcon, ChartBarIcon, TableCellsIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Title, Tooltip, Legend,
} from 'chart.js';
import { useAuthStore } from '../store/auth.store';
import { hasRole, ANALYTICS_ROLES, ADMIN_ROLES } from '../lib/roles';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

type ReportType = 'my-timesheets' | 'utilization' | 'project-effort' | 'overtime' | 'missing';
type ViewMode = 'table' | 'chart';

const CHART_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed',
  '#0891b2', '#db2777', '#059669', '#ea580c', '#4f46e5',
];

function QuickRange({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-600">
      {label}
    </button>
  );
}

export default function ReportsPage() {
  const { user } = useAuthStore();
  const canViewAnalytics = hasRole(user?.role, ANALYTICS_ROLES);
  const isAdmin = hasRole(user?.role, ADMIN_ROLES);

  const now = new Date();
  const [reportType, setReportType] = useState<ReportType>(canViewAnalytics ? 'utilization' : 'my-timesheets');
  const [from, setFrom] = useState(format(startOfMonth(now), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(now, 'yyyy-MM-dd'));
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');

  const setRange = (f: Date, t: Date) => {
    setFrom(format(f, 'yyyy-MM-dd'));
    setTo(format(t, 'yyyy-MM-dd'));
  };

  const endpointMap: Record<ReportType, string> = {
    'my-timesheets': `/timesheets?limit=100&from=${from}&to=${to}`,
    utilization: `/reports/utilization?from=${from}&to=${to}${departmentFilter ? `&departmentId=${departmentFilter}` : ''}`,
    'project-effort': `/reports/project-effort?from=${from}&to=${to}`,
    overtime: `/reports/overtime?from=${from}&to=${to}${employeeFilter ? `&userId=${employeeFilter}` : ''}`,
    missing: `/reports/missing-timesheets?from=${from}&to=${to}`,
  };

  const { data: rawData = [], isLoading, refetch } = useQuery({
    queryKey: ['report', reportType, from, to, departmentFilter, employeeFilter],
    queryFn: async () => {
      const r = await api.get(endpointMap[reportType]);
      if (reportType === 'my-timesheets') return r.data.timesheets || [];
      return r.data;
    },
  });

  const data = Array.isArray(rawData) ? rawData : [];

  const { data: departments } = useQuery({
    queryKey: ['departments-list'],
    queryFn: () => api.get('/departments').then(r => r.data?.departments || r.data || []),
    enabled: isAdmin,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users?limit=200').then(r => r.data),
    enabled: isAdmin,
  });

  const handleExport = async (fmt: string) => {
    if (reportType === 'my-timesheets') {
      const rows = data.map((ts: Record<string, unknown>) => [
        ts.periodStart ? format(new Date(ts.periodStart as string), 'MMM d, yyyy') : '',
        ts.periodEnd ? format(new Date(ts.periodEnd as string), 'MMM d, yyyy') : '',
        (ts.totalHours as number || 0).toFixed(1),
        (ts.billableHours as number || 0).toFixed(1),
        (ts.overtimeHours as number || 0).toFixed(1),
        ts.status as string,
        ts.submittedAt ? format(new Date(ts.submittedAt as string), 'MMM d, yyyy') : '',
      ]);
      const header = ['Period Start', 'Period End', 'Total Hours', 'Billable Hours', 'Overtime Hours', 'Status', 'Submitted At'];
      const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'my-timesheets.csv'; a.click();
      return;
    }
    const r = await api.get('/reports/export', {
      params: { type: reportType, format: fmt, from, to },
      responseType: 'blob',
    });
    const ext = fmt === 'xlsx' ? 'xlsx' : fmt === 'csv' ? 'csv' : 'pdf';
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a'); a.href = url; a.download = `${reportType}-report.${ext}`; a.click();
  };

  const columns: Record<ReportType, { key: string; label: string }[]> = {
    'my-timesheets': [
      { key: 'period', label: 'Period' },
      { key: 'totalHours', label: 'Total Hrs' },
      { key: 'billableHours', label: 'Billable Hrs' },
      { key: 'overtimeHours', label: 'Overtime Hrs' },
      { key: 'status', label: 'Status' },
      { key: 'submittedAt', label: 'Submitted' },
    ],
    utilization: [
      { key: 'employeeId', label: 'Employee ID' },
      { key: 'name', label: 'Name' },
      { key: 'department.name', label: 'Department' },
      { key: 'totalHours', label: 'Total Hrs' },
      { key: 'billableHours', label: 'Billable Hrs' },
      { key: 'utilizationPct', label: 'Utilization %' },
    ],
    'project-effort': [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Project' },
      { key: 'clientName', label: 'Client' },
      { key: 'totalHours', label: 'Hours Used' },
      { key: 'budgetHours', label: 'Budget Hrs' },
      { key: 'budgetUtilization', label: 'Budget %' },
    ],
    overtime: [
      { key: 'user.employeeId', label: 'Employee ID' },
      { key: 'user.firstName', label: 'Name' },
      { key: 'periodStart', label: 'Period Start' },
      { key: 'totalHours', label: 'Total Hrs' },
      { key: 'overtimeHours', label: 'OT Hrs' },
    ],
    missing: [
      { key: 'employeeId', label: 'Employee ID' },
      { key: 'firstName', label: 'First Name' },
      { key: 'lastName', label: 'Last Name' },
      { key: 'email', label: 'Email' },
      { key: 'department.name', label: 'Department' },
    ],
  };

  function getVal(row: Record<string, unknown>, key: string): string | number | boolean | null | undefined {
    if (key === 'period') {
      const s = row.periodStart, e = row.periodEnd;
      if (s && e) return `${format(new Date(s as string), 'MMM d')} – ${format(new Date(e as string), 'MMM d, yyyy')}`;
      return '—';
    }
    if (key === 'name' && row.firstName) return `${row.firstName} ${row.lastName}`;
    const parts = key.split('.');
    let val: unknown = row;
    for (const p of parts) val = (val as Record<string, unknown>)?.[p];
    if (typeof val === 'number') return val.toFixed(1);
    if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val))) {
      try { return format(new Date(val as string), 'MMM d, yyyy'); } catch {}
    }
    return (val as string | number | boolean | null | undefined) ?? '—';
  }

  const STATUS_BADGE: Record<string, string> = {
    DRAFT: 'badge-gray', SUBMITTED: 'badge-blue', APPROVED: 'badge-green',
    REJECTED: 'badge-red', LOCKED: 'badge-purple',
  };

  // Build chart data based on report type
  const chartData = (() => {
    if (!data.length) return null;
    if (reportType === 'utilization') {
      return {
        labels: data.slice(0, 15).map((r: Record<string, unknown>) => `${r.firstName} ${r.lastName}`),
        datasets: [
          {
            label: 'Billable Hours',
            data: data.slice(0, 15).map((r: Record<string, unknown>) => r.billableHours),
            backgroundColor: '#16a34a',
          },
          {
            label: 'Non-Billable Hours',
            data: data.slice(0, 15).map((r: Record<string, unknown>) => (r.nonBillableHours as number) || 0),
            backgroundColor: '#d97706',
          },
        ],
      };
    }
    if (reportType === 'project-effort') {
      return {
        labels: data.map((r: Record<string, unknown>) => r.name),
        datasets: [{
          data: data.map((r: Record<string, unknown>) => r.totalHours),
          backgroundColor: CHART_COLORS,
        }],
      };
    }
    if (reportType === 'my-timesheets') {
      return {
        labels: data.map((r: Record<string, unknown>) => r.periodStart ? format(new Date(r.periodStart as string), 'MMM d') : ''),
        datasets: [
          {
            label: 'Total Hours',
            data: data.map((r: Record<string, unknown>) => r.totalHours),
            backgroundColor: '#2563eb',
          },
          {
            label: 'Billable Hours',
            data: data.map((r: Record<string, unknown>) => r.billableHours),
            backgroundColor: '#16a34a',
          },
        ],
      };
    }
    return null;
  })();

  const reportTypes: { value: ReportType; label: string; adminOnly?: boolean }[] = [
    { value: 'my-timesheets', label: 'My Timesheets' },
    { value: 'utilization', label: 'Employee Utilization', adminOnly: true },
    { value: 'project-effort', label: 'Project Effort', adminOnly: true },
    { value: 'overtime', label: 'Overtime Analysis', adminOnly: true },
    { value: 'missing', label: 'Missing Timesheets', adminOnly: true },
  ];

  const availableTypes = reportTypes.filter(t => !t.adminOnly || canViewAnalytics);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 text-sm">{data.length} records</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setViewMode(viewMode === 'table' ? 'chart' : 'table')}
            className="btn-secondary btn-sm"
          >
            {viewMode === 'table'
              ? <><ChartBarIcon className="h-4 w-4" /> Chart View</>
              : <><TableCellsIcon className="h-4 w-4" /> Table View</>
            }
          </button>
          <button onClick={() => handleExport('xlsx')} className="btn-secondary btn-sm"><ArrowDownTrayIcon className="h-4 w-4" /> Excel</button>
          <button onClick={() => handleExport('csv')} className="btn-secondary btn-sm"><ArrowDownTrayIcon className="h-4 w-4" /> CSV</button>
          {reportType !== 'my-timesheets' && (
            <button onClick={() => handleExport('pdf')} className="btn-secondary btn-sm"><ArrowDownTrayIcon className="h-4 w-4" /> PDF</button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="card p-4 space-y-4">
        <div className="flex gap-4 flex-wrap items-end">
          <div>
            <label className="label">Report Type</label>
            <select
              value={reportType}
              onChange={e => setReportType(e.target.value as ReportType)}
              className="input w-auto"
            >
              {availableTypes.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input w-auto" />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input w-auto" />
          </div>
          <button onClick={() => refetch()} className="btn-primary">
            <ChartBarIcon className="h-4 w-4" /> Generate
          </button>
        </div>

        {/* Quick date ranges */}
        <div className="flex items-center gap-2 flex-wrap">
          <FunnelIcon className="h-4 w-4 text-gray-400" />
          <span className="text-xs text-gray-500">Quick:</span>
          <QuickRange label="This Month" onClick={() => setRange(startOfMonth(now), now)} />
          <QuickRange label="Last Month" onClick={() => setRange(startOfMonth(subMonths(now, 1)), endOfMonth(subMonths(now, 1)))} />
          <QuickRange label="Last 3 Months" onClick={() => setRange(startOfMonth(subMonths(now, 2)), now)} />
          <QuickRange label="Last 6 Months" onClick={() => setRange(startOfMonth(subMonths(now, 5)), now)} />
          <QuickRange label="This Year" onClick={() => setRange(new Date(now.getFullYear(), 0, 1), now)} />
        </div>

        {/* Advanced filters for admins */}
        {isAdmin && (reportType === 'utilization') && (
          <div className="flex gap-4 flex-wrap items-end border-t border-gray-100 pt-4">
            <span className="text-xs text-gray-500 self-center">Filters:</span>
            <div>
              <label className="label">Department</label>
              <select
                value={departmentFilter}
                onChange={e => setDepartmentFilter(e.target.value)}
                className="input w-auto"
              >
                <option value="">All Departments</option>
                {(departments || []).map((d: Record<string, unknown>) => (
                  <option key={d.id as string} value={d.id as string}>{d.name as string}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        {isAdmin && reportType === 'overtime' && (
          <div className="flex gap-4 flex-wrap items-end border-t border-gray-100 pt-4">
            <span className="text-xs text-gray-500 self-center">Filters:</span>
            <div>
              <label className="label">Employee</label>
              <select
                value={employeeFilter}
                onChange={e => setEmployeeFilter(e.target.value)}
                className="input w-auto"
              >
                <option value="">All Employees</option>
                {(usersData?.users || []).map((u: Record<string, unknown>) => (
                  <option key={u.id as string} value={u.id as string}>
                    {u.firstName as string} {u.lastName as string}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Chart View */}
      {viewMode === 'chart' && chartData && !isLoading && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-4">
            {availableTypes.find(t => t.value === reportType)?.label} — Chart
          </h3>
          {reportType === 'project-effort' ? (
            <div className="max-w-lg mx-auto">
              <Doughnut
                data={chartData}
                options={{
                  responsive: true,
                  plugins: {
                    legend: { position: 'right' },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${(ctx.raw as number).toFixed(1)}h` } },
                  },
                }}
              />
            </div>
          ) : (
            <Bar
              data={chartData}
              options={{
                responsive: true,
                plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', intersect: false } },
                scales: { y: { beginAtZero: true, stacked: false } },
              }}
            />
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>{columns[reportType].map(c => <th key={c.key} className="th">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {isLoading ? (
                <tr><td colSpan={columns[reportType].length} className="td text-center py-12">
                  <div className="h-6 w-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto" />
                </td></tr>
              ) : data.map((row: Record<string, unknown>, i: number) => (
                <tr key={i} className="tr-hover">
                  {columns[reportType].map(c => (
                    <td key={c.key} className="td">
                      {c.key === 'status' ? (
                        <span className={STATUS_BADGE[row.status as string] || 'badge-gray'}>{row.status as string}</span>
                      ) : c.key === 'utilizationPct' || c.key === 'budgetUtilization' ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden min-w-[60px]">
                            <div
                              className={`h-full rounded-full ${Number(getVal(row, c.key)) > 100 ? 'bg-red-500' : 'bg-primary-500'}`}
                              style={{ width: `${Math.min(Number(getVal(row, c.key)) || 0, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium w-10">{getVal(row, c.key)}%</span>
                        </div>
                      ) : (
                        String(getVal(row, c.key))
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {!isLoading && !data.length && (
                <tr><td colSpan={columns[reportType].length} className="td text-center text-gray-400 py-12">
                  No data for selected period
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary bar */}
      {!isLoading && data.length > 0 && (reportType === 'utilization' || reportType === 'my-timesheets') && (
        <div className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-xs text-gray-500">Total Hours</p>
            <p className="text-xl font-bold text-gray-900">
              {data.reduce((s: number, r: Record<string, unknown>) => s + ((r.totalHours as number) || 0), 0).toFixed(1)}h
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Billable Hours</p>
            <p className="text-xl font-bold text-green-600">
              {data.reduce((s: number, r: Record<string, unknown>) => s + ((r.billableHours as number) || 0), 0).toFixed(1)}h
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Avg Utilization</p>
            <p className="text-xl font-bold text-blue-600">
              {(
                data.reduce((s: number, r: Record<string, unknown>) => s + ((r.utilizationPct as number) || 0), 0) /
                Math.max(data.filter((r: Record<string, unknown>) => r.totalHours).length, 1)
              ).toFixed(0)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Records</p>
            <p className="text-xl font-bold text-gray-900">{data.length}</p>
          </div>
        </div>
      )}
    </div>
  );
}
