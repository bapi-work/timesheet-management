import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { ArrowDownTrayIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

type ReportType = 'utilization' | 'project-effort' | 'overtime' | 'missing';

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('utilization');
  const [from, setFrom] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const endpointMap: Record<ReportType, string> = {
    utilization: `/reports/utilization?from=${from}&to=${to}`,
    'project-effort': `/reports/project-effort?from=${from}&to=${to}`,
    overtime: `/reports/overtime?from=${from}&to=${to}`,
    missing: `/reports/missing-timesheets?from=${from}&to=${to}`,
  };

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['report', reportType, from, to],
    queryFn: () => api.get(endpointMap[reportType]).then(r => r.data),
  });

  const handleExport = async (fmt: string) => {
    const r = await api.get('/reports/export', {
      params: { type: reportType, format: fmt, from, to },
      responseType: 'blob',
    });
    const ext = fmt === 'xlsx' ? 'xlsx' : fmt === 'csv' ? 'csv' : 'pdf';
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a'); a.href = url; a.download = `${reportType}-report.${ext}`; a.click();
  };

  const columns: Record<ReportType, { key: string; label: string }[]> = {
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
    const parts = key.split('.');
    let val: unknown = row;
    for (const p of parts) val = (val as Record<string, unknown>)?.[p];
    if (typeof val === 'number') return val.toFixed(1);
    if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val))) {
      try { return format(new Date(val as string), 'MMM d, yyyy'); } catch {}
    }
    return (val as string | number | boolean | null | undefined) ?? '—';
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 text-sm">{data.length} records</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleExport('xlsx')} className="btn-secondary btn-sm"><ArrowDownTrayIcon className="h-4 w-4" /> Excel</button>
          <button onClick={() => handleExport('csv')} className="btn-secondary btn-sm"><ArrowDownTrayIcon className="h-4 w-4" /> CSV</button>
          <button onClick={() => handleExport('pdf')} className="btn-secondary btn-sm"><ArrowDownTrayIcon className="h-4 w-4" /> PDF</button>
        </div>
      </div>

      {/* Controls */}
      <div className="card p-4 flex gap-4 flex-wrap items-end">
        <div>
          <label className="label">Report Type</label>
          <select value={reportType} onChange={e => setReportType(e.target.value as ReportType)} className="input w-auto">
            <option value="utilization">Employee Utilization</option>
            <option value="project-effort">Project Effort</option>
            <option value="overtime">Overtime Analysis</option>
            <option value="missing">Missing Timesheets</option>
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
                    {c.key === 'utilizationPct' || c.key === 'budgetUtilization'
                      ? <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-primary-500 rounded-full" style={{ width: `${Math.min(Number(getVal(row, c.key)) || 0, 100)}%` }} />
                          </div>
                          <span className="text-xs font-medium w-10">{getVal(row, c.key)}%</span>
                        </div>
                      : String(getVal(row, c.key))}
                  </td>
                ))}
              </tr>
            ))}
            {!isLoading && !data.length && (
              <tr><td colSpan={columns[reportType].length} className="td text-center text-gray-400 py-12">No data for selected period</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
