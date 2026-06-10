import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { ArrowLeftIcon, PencilIcon, TrashIcon, KeyIcon, ShieldExclamationIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { useAuthStore } from '../store/auth.store';
import { ADMIN_ROLES, hasRole } from '../lib/roles';
import EmployeeFormModal from '../components/EmployeeFormModal';
import toast from 'react-hot-toast';

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const isAdmin = hasRole(user?.role, ADMIN_ROLES);
  const [showEditModal, setShowEditModal] = useState(false);

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/users/${id}`).then(r => r.data),
  });

  const { data: timesheets = [] } = useQuery({
    queryKey: ['employee', id, 'timesheets'],
    queryFn: () => api.get(`/users/${id}/timesheets`).then(r => r.data),
  });

  const [resetPasswordResult, setResetPasswordResult] = useState<string | null>(null);

  const resetPasswordMutation = useMutation({
    mutationFn: () => api.post(`/users/${id}/reset-password`).then(r => r.data),
    onSuccess: (data) => {
      setResetPasswordResult(data.tempPassword);
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to reset password');
    },
  });

  const disableMfaMutation = useMutation({
    mutationFn: () => api.delete(`/users/${id}/mfa`),
    onSuccess: () => {
      toast.success('MFA disabled for this employee');
      qc.invalidateQueries({ queryKey: ['employee', id] });
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to disable MFA');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/users/${id}`),
    onSuccess: () => {
      toast.success('Employee deactivated');
      qc.invalidateQueries({ queryKey: ['employees'] });
      navigate('/employees');
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to deactivate employee');
    },
  });

  const handleDelete = () => {
    if (confirm(`Deactivate ${employee?.firstName} ${employee?.lastName}? They will no longer be able to log in.`)) {
      deleteMutation.mutate();
    }
  };

  if (isLoading) return <div className="flex justify-center py-16"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (!employee) return <div className="card text-center py-12 text-gray-400">Employee not found</div>;

  return (
    <div className="space-y-6">
      <Link to="/employees" className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm">
        <ArrowLeftIcon className="h-4 w-4" /> Back to Employees
      </Link>

      <div className="card">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-6">
            <div className="h-16 w-16 rounded-full bg-primary-100 flex items-center justify-center text-2xl font-bold text-primary-700 flex-shrink-0">
              {employee.firstName?.[0]}{employee.lastName?.[0]}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900">{employee.firstName} {employee.lastName}</h1>
              <p className="text-gray-500">{employee.email}</p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="badge-blue">{employee.role?.replace(/_/g, ' ')}</span>
                <span className={employee.isActive ? 'badge-green' : 'badge-red'}>{employee.isActive ? 'Active' : 'Inactive'}</span>
                {employee.designation && <span className="text-sm text-gray-600">{employee.designation}</span>}
              </div>
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowEditModal(true)}
                className="btn-secondary btn-sm flex items-center gap-1.5"
              >
                <PencilIcon className="h-4 w-4" /> Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="btn-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium"
              >
                <TrashIcon className="h-4 w-4" /> Deactivate
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-500">Employee ID</p>
            <p className="font-semibold mt-0.5">{employee.employeeId}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Department</p>
            <p className="font-semibold mt-0.5">{employee.department?.name || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Manager</p>
            <p className="font-semibold mt-0.5">{employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Join Date</p>
            <p className="font-semibold mt-0.5">{employee.joinDate ? format(new Date(employee.joinDate), 'MMM d, yyyy') : '—'}</p>
          </div>
          {employee.phone && (
            <div>
              <p className="text-xs text-gray-500">Phone</p>
              <p className="font-semibold mt-0.5">{employee.phone}</p>
            </div>
          )}
          {employee.timezone && (
            <div>
              <p className="text-xs text-gray-500">Timezone</p>
              <p className="font-semibold mt-0.5">{employee.timezone}</p>
            </div>
          )}
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

      {/* Security — admin only */}
      {isAdmin && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">Security</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                if (confirm(`Reset password for ${employee.firstName} ${employee.lastName}? A new temporary password will be generated.`)) {
                  resetPasswordMutation.mutate();
                }
              }}
              disabled={resetPasswordMutation.isPending}
              className="btn-secondary flex items-center gap-2"
            >
              <KeyIcon className="h-4 w-4" /> Reset Password
            </button>
            {employee.mfaEnabled && (
              <button
                onClick={() => {
                  if (confirm(`Disable MFA for ${employee.firstName} ${employee.lastName}?`)) {
                    disableMfaMutation.mutate();
                  }
                }}
                disabled={disableMfaMutation.isPending}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-orange-200 text-orange-600 hover:bg-orange-50 text-sm font-medium"
              >
                <ShieldExclamationIcon className="h-4 w-4" /> Disable MFA
              </button>
            )}
            {!employee.mfaEnabled && (
              <p className="text-sm text-gray-400 flex items-center gap-1.5"><ShieldExclamationIcon className="h-4 w-4" /> MFA not enabled</p>
            )}
          </div>

          {resetPasswordResult && (
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm font-medium text-yellow-800 mb-1">Temporary password (share securely, shown once):</p>
              <code className="text-base font-mono font-bold text-yellow-900 select-all">{resetPasswordResult}</code>
              <button onClick={() => setResetPasswordResult(null)} className="ml-4 text-xs text-yellow-600 underline">Dismiss</button>
            </div>
          )}
        </div>
      )}

      {showEditModal && (
        <EmployeeFormModal
          employee={employee}
          onClose={() => setShowEditModal(false)}
        />
      )}
    </div>
  );
}
