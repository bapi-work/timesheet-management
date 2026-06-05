import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: user, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/users/${id}`).then(r => r.data),
  });

  const { data: timesheets = [] } = useQuery({
    queryKey: ['employee', id, 'timesheets'],
    queryFn: () => api.get(`/users/${id}/timesheets`).then(r => r.data),
  });

  if (isLoading) return <div className="flex justify-center py-16"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return <div className="card text-center py-12 text-gray-400">Employee not found</div>;

  return (
    <div className="space-y-6">
      <Link to="/employees" className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm">
        <ArrowLeftIcon className="h-4 w-4" /> Back to Employees
      </Link>

      <div className="card">
        <div className="flex items-start gap-6">
          <div className="h-16 w-16 rounded-full bg-primary-100 flex items-center justify-center text-2xl font-bold text-primary-700 flex-shrink-0">
            {user.firstName?.[0]}{user.lastName?.[0]}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{user.firstName} {user.lastName}</h1>
            <p className="text-gray-500">{user.email}</p>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="badge-blue">{user.role?.replace(/_/g, ' ')}</span>
              <span className={user.isActive ? 'badge-green' : 'badge-red'}>{user.isActive ? 'Active' : 'Inactive'}</span>
              {user.designation && <span className="text-sm text-gray-600">{user.designation}</span>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-500">Employee ID</p>
            <p className="font-semibold mt-0.5">{user.employeeId}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Department</p>
            <p className="font-semibold mt-0.5">{user.department?.name || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Manager</p>
            <p className="font-semibold mt-0.5">{user.manager ? `${user.manager.firstName} ${user.manager.lastName}` : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Join Date</p>
            <p className="font-semibold mt-0.5">{user.joinDate ? format(new Date(user.joinDate), 'MMM d, yyyy') : '—'}</p>
          </div>
        </div>
      </div>

      {/* Timesheet History */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b font-semibold text-gray-900">Timesheet History</div>
        <div className="table-wrapper border-0">
          <table className="table">
            <thead><tr>
              <th className="th">Period</th>
              <th className="th">Total</th>
              <th className="th">Billable</th>
              <th className="th">OT</th>
              <th className="th">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {(timesheets as Record<string, unknown>[]).slice(0, 10).map(ts => (
                <tr key={ts.id as string} className="tr-hover">
                  <td className="td">{format(new Date(ts.periodStart as string), 'MMM d')} – {format(new Date(ts.periodEnd as string), 'MMM d, yyyy')}</td>
                  <td className="td">{(ts.totalHours as number).toFixed(1)}h</td>
                  <td className="td">{(ts.billableHours as number).toFixed(1)}h</td>
                  <td className="td">{(ts.overtimeHours as number).toFixed(1)}h</td>
                  <td className="td"><span className={ts.status === 'APPROVED' ? 'badge-green' : ts.status === 'REJECTED' ? 'badge-red' : ts.status === 'SUBMITTED' ? 'badge-blue' : 'badge-gray'}>{ts.status as string}</span></td>
                </tr>
              ))}
              {!timesheets.length && (
                <tr><td colSpan={5} className="td text-center text-gray-400 py-8">No timesheets yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
