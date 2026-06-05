import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { PlusIcon, CalendarDaysIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/auth.store';
import { ADMIN_ROLES, hasRole } from '../lib/roles';

const LEAVE_COLORS: Record<string, string> = {
  ANNUAL: 'badge-blue', SICK: 'badge-red', MATERNITY: 'badge-purple',
  PATERNITY: 'badge-purple', UNPAID: 'badge-gray', COMPENSATORY: 'badge-green', OTHER: 'badge-yellow',
};

export default function LeavePage() {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const [showModal, setShowModal] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm();
  const isLeaveAdmin = hasRole(user?.role, ADMIN_ROLES);
  const canSeeTeamLeave = isLeaveAdmin || user?.role === 'DEPARTMENT_MANAGER';

  const { data: balances = [] } = useQuery({
    queryKey: ['leave', 'balance'],
    queryFn: () => api.get('/leave/balance').then(r => r.data),
  });

  const { data: requests = [] } = useQuery({
    queryKey: ['leave', 'requests'],
    queryFn: () => api.get('/leave/requests').then(r => r.data),
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ['leave', 'holidays'],
    queryFn: () => api.get('/leave/holidays').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/leave/requests', data),
    onSuccess: () => { toast.success('Leave request submitted!'); qc.invalidateQueries({ queryKey: ['leave'] }); setShowModal(false); reset(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave/requests/${id}/cancel`),
    onSuccess: () => { toast.success('Cancelled'); qc.invalidateQueries({ queryKey: ['leave'] }); },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, comments }: { id: string; comments?: string }) => api.post(`/leave/requests/${id}/approve`, { comments }),
    onSuccess: () => { toast.success('Leave approved'); qc.invalidateQueries({ queryKey: ['leave'] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, comments }: { id: string; comments: string }) => api.post(`/leave/requests/${id}/reject`, { comments }),
    onSuccess: () => { toast.success('Leave rejected'); qc.invalidateQueries({ queryKey: ['leave'] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to reject'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          <PlusIcon className="h-4 w-4" /> Request Leave
        </button>
      </div>

      {/* Leave Balances */}
      {balances.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {balances.map((b: Record<string, unknown>) => (
            <div key={b.id as string} className="card text-center">
              <p className="text-sm text-gray-500">{(b.leaveType as string).replace(/_/g, ' ')}</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{(b.entitled as number) - (b.used as number)}</p>
              <p className="text-xs text-gray-400">{b.used as number} used of {b.entitled as number}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Requests */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="font-semibold text-gray-900">{canSeeTeamLeave ? 'Leave Requests' : 'My Leave Requests'}</h2>
          {requests.length === 0 ? (
            <div className="card text-center py-10 text-gray-400">No leave requests yet</div>
          ) : (
            requests.map((req: Record<string, unknown>) => {
              const isOwnRequest = req.userId === user?.id;
              const canReviewRequest = req.status === 'PENDING' && !isOwnRequest && (
                isLeaveAdmin || (req.approver as { id?: string } | undefined)?.id === user?.id
              );

              return (
              <div key={req.id as string} className="card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <CalendarDaysIcon className="h-8 w-8 text-gray-300" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={LEAVE_COLORS[req.leaveType as string] || 'badge-gray'}>{(req.leaveType as string).replace(/_/g, ' ')}</span>
                        <span className={req.status === 'APPROVED' ? 'badge-green' : req.status === 'REJECTED' ? 'badge-red' : req.status === 'CANCELLED' ? 'badge-gray' : 'badge-yellow'}>
                          {req.status as string}
                        </span>
                      </div>
                      {canSeeTeamLeave && !!req.user && (
                        <p className="text-xs text-gray-500 mt-1">
                          {(req.user as { firstName: string; lastName: string }).firstName} {(req.user as { firstName: string; lastName: string }).lastName}
                        </p>
                      )}
                      <p className="text-sm text-gray-700 mt-1">
                        {format(new Date(req.startDate as string), 'MMM d')} – {format(new Date(req.endDate as string), 'MMM d, yyyy')}
                        <span className="ml-2 text-gray-500">({req.days as number} day{(req.days as number) !== 1 ? 's' : ''})</span>
                      </p>
                      {!!req.reason && <p className="text-xs text-gray-400 mt-0.5">{req.reason as string}</p>}
                      {!!req.approverComments && <p className="text-xs text-orange-600 mt-0.5">"{req.approverComments as string}"</p>}
                    </div>
                  </div>
                  {req.status === 'PENDING' && isOwnRequest && (
                    <button onClick={() => cancelMutation.mutate(req.id as string)} className="btn-secondary btn-sm">Cancel</button>
                  )}
                  {canReviewRequest && (
                    <div className="flex gap-2">
                      <button onClick={() => approveMutation.mutate({ id: req.id as string })} disabled={approveMutation.isPending} className="btn-success btn-sm">Approve</button>
                      <button
                        onClick={() => {
                          const comments = prompt('Reason for rejection?');
                          if (comments?.trim()) rejectMutation.mutate({ id: req.id as string, comments });
                        }}
                        disabled={rejectMutation.isPending}
                        className="btn-danger btn-sm"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
              );
            })
          )}
        </div>

        {/* Upcoming Holidays */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">Upcoming Holidays</h2>
          <div className="card p-0 overflow-hidden">
            {holidays.slice(0, 10).map((h: Record<string, unknown>) => (
              <div key={h.id as string} className="flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-gray-50">
                <div className="text-center w-10">
                  <p className="text-xs text-gray-500">{format(new Date(h.date as string), 'MMM')}</p>
                  <p className="text-lg font-bold text-gray-900">{format(new Date(h.date as string), 'd')}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{h.name as string}</p>
                  {!!h.isOptional && <span className="badge-yellow text-xs">Optional</span>}
                </div>
              </div>
            ))}
            {holidays.length === 0 && <p className="text-center text-gray-400 py-6 text-sm">No holidays configured</p>}
          </div>
        </div>
      </div>

      {/* Request Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-5">Request Leave</h3>
            <form onSubmit={handleSubmit(d => createMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
              <div>
                <label className="label">Leave Type *</label>
                <select {...register('leaveType', { required: true })} className={`input ${errors.leaveType ? 'input-error' : ''}`}>
                  <option value="">Select type</option>
                  {['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'COMPENSATORY', 'OTHER'].map(t => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start Date *</label>
                  <input {...register('startDate', { required: true })} type="date" className="input" />
                </div>
                <div>
                  <label className="label">End Date *</label>
                  <input {...register('endDate', { required: true })} type="date" className="input" />
                </div>
              </div>
              <div>
                <label className="label">Reason</label>
                <textarea {...register('reason')} className="input" rows={3} placeholder="Optional reason..." />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setShowModal(false); reset(); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">Submit Request</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
