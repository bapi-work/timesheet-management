import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '../lib/api';
import { ClockIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/auth.store';
import { hasRole, ADMIN_ROLES } from '../lib/roles';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', SUBMITTED: 'badge-blue', APPROVED: 'badge-green',
  REJECTED: 'badge-red', LOCKED: 'badge-purple',
};

export default function TimesheetListPage() {
  const { user } = useAuthStore();
  const isAdmin = hasRole(user?.role, ADMIN_ROLES);

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [userFilter, setUserFilter] = useState('');

  const params = new URLSearchParams({ page: String(page), limit: '15' });
  if (status) params.set('status', status);
  if (isAdmin && userFilter) params.set('userId', userFilter);

  const { data, isLoading } = useQuery({
    queryKey: ['timesheets', page, status, userFilter],
    queryFn: () => api.get(`/timesheets?${params}`).then(r => r.data),
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users?limit=200').then(r => r.data),
    enabled: isAdmin,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          {isAdmin ? 'All Timesheets' : 'My Timesheets'}
        </h1>
        <Link to="/timesheets/current" className="btn-primary">
          <ClockIcon className="h-4 w-4" /> Current Timesheet
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {['', 'DRAFT', 'SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'LOCKED'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${status === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {s || 'All'}
          </button>
        ))}

        {isAdmin && (
          <select
            value={userFilter}
            onChange={e => { setUserFilter(e.target.value); setPage(1); }}
            className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Employees</option>
            {(usersData?.users || []).map((u: Record<string, unknown>) => (
              <option key={u.id as string} value={u.id as string}>
                {u.firstName as string} {u.lastName as string}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              {isAdmin && <th className="th">Employee</th>}
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
              <tr><td colSpan={isAdmin ? 8 : 7} className="td text-center py-10"><div className="h-6 w-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
            ) : (data?.timesheets || []).map((ts: Record<string, unknown>) => {
              const u = ts.user as Record<string, unknown> | undefined;
              return (
                <tr key={ts.id as string} className="tr-hover">
                  {isAdmin && (
                    <td className="td">
                      {u ? `${u.firstName as string} ${u.lastName as string}` : '—'}
                      {u?.employeeId ? <span className="ml-1 text-xs text-gray-400">({u.employeeId as string})</span> : null}
                    </td>
                  )}
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
              );
            })}
            {!isLoading && !data?.timesheets?.length && (
              <tr><td colSpan={isAdmin ? 8 : 7} className="td text-center text-gray-400 py-10">No timesheets found</td></tr>
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
