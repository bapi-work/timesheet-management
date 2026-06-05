import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '../lib/api';
import { ClockIcon } from '@heroicons/react/24/outline';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', SUBMITTED: 'badge-blue', APPROVED: 'badge-green',
  REJECTED: 'badge-red', LOCKED: 'badge-purple',
};

export default function TimesheetListPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['timesheets', page, status],
    queryFn: () => api.get(`/timesheets?page=${page}&limit=15&status=${status}`).then(r => r.data),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">My Timesheets</h1>
        <Link to="/timesheets/current" className="btn-primary">
          <ClockIcon className="h-4 w-4" /> Current Timesheet
        </Link>
      </div>

      <div className="flex gap-2">
        {['', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'LOCKED'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${status === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Period</th>
              <th className="th">Total Hours</th>
              <th className="th">Billable</th>
              <th className="th">Overtime</th>
              <th className="th">Status</th>
              <th className="th">Submitted</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <tr><td colSpan={7} className="td text-center py-10"><div className="h-6 w-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
            ) : (data?.timesheets || []).map((ts: Record<string, unknown>) => (
              <tr key={ts.id as string} className="tr-hover">
                <td className="td font-medium">
                  {format(new Date(ts.periodStart as string), 'MMM d')} – {format(new Date(ts.periodEnd as string), 'MMM d, yyyy')}
                </td>
                <td className="td">{(ts.totalHours as number).toFixed(1)}h</td>
                <td className="td text-green-600">{(ts.billableHours as number).toFixed(1)}h</td>
                <td className="td text-orange-600">{(ts.overtimeHours as number).toFixed(1)}h</td>
                <td className="td"><span className={STATUS_BADGE[ts.status as string]}>{ts.status as string}</span></td>
                <td className="td text-gray-400 text-xs">{ts.submittedAt ? format(new Date(ts.submittedAt as string), 'MMM d, yyyy') : '—'}</td>
                <td className="td">
                  <Link to={`/timesheets/${ts.id}`} className="text-primary-600 hover:underline text-sm">View</Link>
                </td>
              </tr>
            ))}
            {!isLoading && !data?.timesheets?.length && (
              <tr><td colSpan={7} className="td text-center text-gray-400 py-10">No timesheets found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data?.total > 15 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Showing {(page - 1) * 15 + 1}–{Math.min(page * 15, data.total)} of {data.total}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => p - 1)} disabled={page === 1} className="btn-secondary btn-sm">Previous</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 15 >= data.total} className="btn-secondary btn-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
