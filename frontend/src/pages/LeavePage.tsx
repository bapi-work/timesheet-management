import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { PlusIcon, CalendarDaysIcon, TrashIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/auth.store';
import { ADMIN_ROLES, hasRole } from '../lib/roles';

const LEAVE_COLORS: Record<string, string> = {
  ANNUAL: 'badge-blue', SICK: 'badge-red', MATERNITY: 'badge-purple',
  PATERNITY: 'badge-purple', UNPAID: 'badge-gray', COMPENSATORY: 'badge-green', OTHER: 'badge-yellow',
};

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'COMPENSATORY', 'OTHER'];

type Tab = 'my' | 'team' | 'admin';

export default function LeavePage() {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const [showModal, setShowModal] = useState(false);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceTarget, setBalanceTarget] = useState<{ userId: string; name: string; leaveType: string; current: number } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showBulkEntitlementModal, setShowBulkEntitlementModal] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm();
  const docInputRef = useRef<HTMLInputElement>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const { register: registerHoliday, handleSubmit: handleSubmitHoliday, reset: resetHoliday } = useForm();
  const { register: registerBalance, handleSubmit: handleSubmitBalance, reset: resetBalance, setValue } = useForm();

  const isHrAdmin = hasRole(user?.role, ADMIN_ROLES);
  const canSeeTeamLeave = isHrAdmin || user?.role === 'DEPARTMENT_MANAGER' || user?.role === 'PROJECT_MANAGER' || user?.role === 'TEAM_LEAD';

  const defaultTab: Tab = isHrAdmin ? 'admin' : canSeeTeamLeave ? 'team' : 'my';
  const [tab, setTab] = useState<Tab>(defaultTab);

  const { data: balances = [] } = useQuery({
    queryKey: ['leave', 'balance'],
    queryFn: () => api.get('/leave/balance').then(r => r.data),
  });

  // For employees, backend returns only their own requests. For managers it returns all.
  // We always fetch and then filter for "my" view.
  const { data: allVisibleRequests = [] } = useQuery({
    queryKey: ['leave', 'requests', statusFilter],
    queryFn: () => api.get(`/leave/requests${statusFilter ? `?status=${statusFilter}` : ''}`).then(r => r.data),
  });

  const myRequests = (allVisibleRequests as Record<string, unknown>[]).filter(r => r.userId === user?.id);
  const teamRequests = allVisibleRequests as Record<string, unknown>[];

  const { data: holidays = [] } = useQuery({
    queryKey: ['leave', 'holidays'],
    queryFn: () => api.get('/leave/holidays').then(r => r.data),
  });

  const { data: allBalances = [] } = useQuery({
    queryKey: ['leave', 'all-balances'],
    queryFn: () => api.get('/leave/balances/all').then(r => r.data),
    enabled: isHrAdmin,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/leave/requests', data),
    onSuccess: () => {
      toast.success('Leave request submitted!');
      qc.invalidateQueries({ queryKey: ['leave'] });
      setShowModal(false);
      reset();
      setDocFile(null);
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const handleLeaveSubmit = async (d: Record<string, unknown>) => {
    let documentUrl: string | undefined;
    if (docFile) {
      setDocUploading(true);
      try {
        const fd = new FormData();
        fd.append('file', docFile);
        const res = await api.post('/leave/upload-doc', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        documentUrl = res.data.url;
      } catch {
        toast.error('Failed to upload document');
        setDocUploading(false);
        return;
      }
      setDocUploading(false);
    }
    createMutation.mutate({ ...d, documentUrl });
  };

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
    onSuccess: () => { toast.success('Leave rejected'); qc.invalidateQueries({ queryKey: ['leave'] }); setRejectTarget(null); setRejectComment(''); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to reject'),
  });

  const createHolidayMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/leave/holidays', data),
    onSuccess: () => { toast.success('Holiday added'); qc.invalidateQueries({ queryKey: ['leave', 'holidays'] }); setShowHolidayModal(false); resetHoliday(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/leave/holidays/${id}`),
    onSuccess: () => { toast.success('Holiday removed'); qc.invalidateQueries({ queryKey: ['leave', 'holidays'] }); },
  });

  const updateBalanceMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/leave/balances', data),
    onSuccess: () => { toast.success('Balance updated'); qc.invalidateQueries({ queryKey: ['leave', 'all-balances'] }); setShowBalanceModal(false); resetBalance(); setBalanceTarget(null); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const bulkEntitlementMutation = useMutation({
    mutationFn: (data: { leaveType: string; year: number; entitled: number }) => api.post('/leave/balances/bulk-entitlement', data),
    onSuccess: (r) => { toast.success(r.data.message); qc.invalidateQueries({ queryKey: ['leave', 'all-balances'] }); setShowBulkEntitlementModal(false); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const deleteBalanceMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/leave/balances/${id}`),
    onSuccess: () => { toast.success('Balance record deleted'); qc.invalidateQueries({ queryKey: ['leave', 'all-balances'] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const openBalanceModal = (userId: string, name: string, leaveType: string, current: number) => {
    setBalanceTarget({ userId, name, leaveType, current });
    setValue('entitled', current);
    setShowBalanceModal(true);
  };

  const pendingTeam = (teamRequests as Record<string, unknown>[]).filter(r => r.status === 'PENDING' && r.userId !== user?.id);

  const renderRequest = (req: Record<string, unknown>, showUser: boolean, canReview: boolean) => {
    const isOwnRequest = req.userId === user?.id;
    return (
      <div key={req.id as string} className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CalendarDaysIcon className="h-8 w-8 text-gray-300" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={LEAVE_COLORS[req.leaveType as string] || 'badge-gray'}>{(req.leaveType as string).replace(/_/g, ' ')}</span>
                <span className={req.status === 'APPROVED' ? 'badge-green' : req.status === 'REJECTED' ? 'badge-red' : req.status === 'CANCELLED' ? 'badge-gray' : 'badge-yellow'}>
                  {req.status as string}
                </span>
              </div>
              {showUser && !!(req.user) && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {(req.user as { firstName: string; lastName: string }).firstName} {(req.user as { firstName: string; lastName: string }).lastName}
                </p>
              )}
              <p className="text-sm text-gray-700 mt-1">
                {format(new Date(req.startDate as string), 'MMM d')} – {format(new Date(req.endDate as string), 'MMM d, yyyy')}
                <span className="ml-2 text-gray-500">({req.days as number} day{(req.days as number) !== 1 ? 's' : ''})</span>
                {req.dayType === 'HALF_DAY' && <span className="ml-2 badge-yellow text-xs">Half Day</span>}
              </p>
              {!!(req.reason) && <p className="text-xs text-gray-400 mt-0.5">{req.reason as string}</p>}
              {!!(req.approverComments) && <p className="text-xs text-orange-600 mt-0.5">"{req.approverComments as string}"</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {req.status === 'PENDING' && isOwnRequest && (
              <button onClick={() => cancelMutation.mutate(req.id as string)} className="btn-secondary btn-sm">Cancel</button>
            )}
            {canReview && req.status === 'PENDING' && !isOwnRequest && (
              <>
                <button onClick={() => approveMutation.mutate({ id: req.id as string })} disabled={approveMutation.isPending} className="btn-success btn-sm">Approve</button>
                <button onClick={() => setRejectTarget(req.id as string)} className="btn-danger btn-sm">Reject</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          <PlusIcon className="h-4 w-4" /> Request Leave
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button onClick={() => setTab('my')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'my' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          My Leave
        </button>
        {canSeeTeamLeave && (
          <button onClick={() => setTab('team')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'team' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            Team Leave
            {pendingTeam.length > 0 && <span className="ml-2 bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">{pendingTeam.length}</span>}
          </button>
        )}
        {isHrAdmin && (
          <button onClick={() => setTab('admin')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'admin' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            HR Admin
          </button>
        )}
      </div>

      {/* My Leave Tab */}
      {tab === 'my' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {/* Leave Balances — show all types, default to 0 if no record */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {LEAVE_TYPES.map((lt) => {
                const b = (balances as Record<string, unknown>[]).find(x => x.leaveType === lt);
                const entitled = (b?.entitled as number) || 0;
                const used = (b?.used as number) || 0;
                const remaining = entitled - used;
                return (
                  <div key={lt} className="card text-center py-3">
                    <p className="text-xs text-gray-500">{lt.replace(/_/g, ' ')}</p>
                    <p className={`text-3xl font-bold mt-1 ${remaining < 0 ? 'text-red-600' : 'text-gray-900'}`}>{remaining}</p>
                    <p className="text-xs text-gray-400">{used} used of {entitled}</p>
                  </div>
                );
              })}
            </div>
            <h2 className="font-semibold text-gray-900">My Leave Requests</h2>
            {myRequests.length === 0
              ? <div className="card text-center py-10 text-gray-400">No leave requests yet</div>
              : (myRequests as Record<string, unknown>[]).map(req => renderRequest(req, false, false))
            }
          </div>
          {/* Upcoming Holidays */}
          <div>
            <h2 className="font-semibold text-gray-900 mb-3">Upcoming Holidays</h2>
            <div className="card p-0 overflow-hidden">
              {(holidays as Record<string, unknown>[]).slice(0, 10).map((h) => (
                <div key={h.id as string} className="flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-gray-50">
                  <div className="text-center w-10">
                    <p className="text-xs text-gray-500">{format(new Date(h.date as string), 'MMM')}</p>
                    <p className="text-lg font-bold text-gray-900">{format(new Date(h.date as string), 'd')}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{h.name as string}</p>
                    {!!(h.isOptional) && <span className="badge-yellow text-xs">Optional</span>}
                  </div>
                </div>
              ))}
              {holidays.length === 0 && <p className="text-center text-gray-400 py-6 text-sm">No holidays configured</p>}
            </div>
          </div>
        </div>
      )}

      {/* Team Leave Tab */}
      {tab === 'team' && canSeeTeamLeave && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {['', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {s || 'All'}
              </button>
            ))}
          </div>
          {(teamRequests as Record<string, unknown>[]).filter(r => r.userId !== user?.id).length === 0
            ? <div className="card text-center py-10 text-gray-400">No leave requests</div>
            : (teamRequests as Record<string, unknown>[])
                .filter(r => r.userId !== user?.id)
                .map(req => renderRequest(req, true, true))
          }
        </div>
      )}

      {/* HR Admin Tab */}
      {tab === 'admin' && isHrAdmin && (
        <div className="space-y-8">
          {/* All Leave Requests */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">All Leave Requests</h2>
              <div className="flex gap-2">
                {['', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {s || 'All'}
                  </button>
                ))}
              </div>
            </div>
            {(teamRequests as Record<string, unknown>[]).length === 0
              ? <div className="card text-center py-10 text-gray-400">No leave requests</div>
              : (teamRequests as Record<string, unknown>[]).map(req => renderRequest(req, true, true))
            }
          </div>

          {/* Leave Balances Management */}
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-semibold text-gray-900">Leave Balances — {new Date().getFullYear()}</h2>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setShowBulkEntitlementModal(true)}
                  className="btn-secondary btn-sm"
                >
                  Bulk Set Entitlement
                </button>
              </div>
            </div>
            {(allBalances as Record<string, unknown>[]).length === 0 ? (
              <div className="card text-center py-8 text-gray-400">No leave balances configured. Approve leave requests to create them, or set entitlements manually.</div>
            ) : (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="th">Employee</th>
                      <th className="th">Leave Type</th>
                      <th className="th">Entitled</th>
                      <th className="th">Used</th>
                      <th className="th">Remaining</th>
                      <th className="th"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {(allBalances as Record<string, unknown>[]).map((b) => {
                      const u = b.user as { firstName: string; lastName: string } | undefined;
                      const remaining = (b.entitled as number) - (b.used as number);
                      return (
                        <tr key={b.id as string} className="tr-hover">
                          <td className="td font-medium">{u?.firstName} {u?.lastName}</td>
                          <td className="td"><span className={LEAVE_COLORS[b.leaveType as string] || 'badge-gray'}>{(b.leaveType as string).replace(/_/g, ' ')}</span></td>
                          <td className="td">{b.entitled as number}</td>
                          <td className="td">{b.used as number}</td>
                          <td className="td">
                            <span className={remaining < 0 ? 'text-red-600 font-semibold' : remaining === 0 ? 'text-orange-500' : 'text-green-600'}>{remaining}</span>
                          </td>
                          <td className="td">
                            <div className="flex gap-2">
                              <button onClick={() => openBalanceModal(b.userId as string, `${u?.firstName} ${u?.lastName}`, b.leaveType as string, b.entitled as number)} className="btn-secondary btn-sm">Edit</button>
                              <button onClick={() => { if (window.confirm('Delete this balance record?')) deleteBalanceMutation.mutate(b.id as string); }} className="text-red-400 hover:text-red-600 btn-sm"><TrashIcon className="h-4 w-4" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Holiday Management */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Public Holidays</h2>
              <button onClick={() => setShowHolidayModal(true)} className="btn-primary btn-sm">
                <PlusIcon className="h-4 w-4" /> Add Holiday
              </button>
            </div>
            <div className="card p-0 overflow-hidden">
              {(holidays as Record<string, unknown>[]).length === 0 && (
                <p className="text-center text-gray-400 py-6 text-sm">No holidays configured</p>
              )}
              {(holidays as Record<string, unknown>[]).map((h) => (
                <div key={h.id as string} className="flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-gray-50">
                  <div className="text-center w-12 flex-shrink-0">
                    <p className="text-xs text-gray-500">{format(new Date(h.date as string), 'MMM')}</p>
                    <p className="text-lg font-bold text-gray-900">{format(new Date(h.date as string), 'd')}</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{h.name as string}</p>
                    {!!(h.isOptional) && <span className="badge-yellow text-xs">Optional</span>}
                  </div>
                  <button onClick={() => { if (confirm(`Remove "${h.name}"?`)) deleteHolidayMutation.mutate(h.id as string); }} className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Request Leave Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-5">Request Leave</h3>
            <form onSubmit={handleSubmit(d => handleLeaveSubmit(d as Record<string, unknown>))} className="space-y-4">
              <div>
                <label className="label">Leave Type *</label>
                <select {...register('leaveType', { required: true })} className={`input ${errors.leaveType ? 'input-error' : ''}`}>
                  <option value="">Select type</option>
                  {LEAVE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
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
                <label className="label">Day Type</label>
                <select {...register('dayType')} className="input">
                  <option value="FULL_DAY">Full Day</option>
                  <option value="HALF_DAY">Half Day</option>
                </select>
              </div>
              <div>
                <label className="label">Reason</label>
                <textarea {...register('reason')} className="input" rows={3} placeholder="Optional reason..." />
              </div>
              <div>
                <label className="label">Supporting Document <span className="text-gray-400 font-normal">(optional)</span></label>
                <input ref={docInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx" className="hidden" onChange={e => setDocFile(e.target.files?.[0] || null)} />
                <button type="button" onClick={() => docInputRef.current?.click()} className="btn-secondary w-full flex items-center gap-2 justify-center">
                  <PaperClipIcon className="h-4 w-4" />
                  {docFile ? docFile.name : 'Attach Medical Certificate or Document'}
                </button>
                {docFile && (
                  <button type="button" onClick={() => { setDocFile(null); if (docInputRef.current) docInputRef.current.value = ''; }} className="text-xs text-red-500 hover:underline mt-1">Remove</button>
                )}
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setShowModal(false); reset(); setDocFile(null); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createMutation.isPending || docUploading} className="btn-primary">
                  {docUploading ? 'Uploading…' : createMutation.isPending ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Holiday Modal */}
      {showHolidayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-5">Add Public Holiday</h3>
            <form onSubmit={handleSubmitHoliday(d => createHolidayMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
              <div>
                <label className="label">Holiday Name *</label>
                <input {...registerHoliday('name', { required: true })} type="text" className="input" placeholder="e.g. New Year's Day" />
              </div>
              <div>
                <label className="label">Date *</label>
                <input {...registerHoliday('date', { required: true })} type="date" className="input" />
              </div>
              <div className="flex items-center gap-2">
                <input {...registerHoliday('isOptional')} type="checkbox" id="isOptional" className="rounded" />
                <label htmlFor="isOptional" className="text-sm text-gray-700">Optional holiday</label>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setShowHolidayModal(false); resetHoliday(); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createHolidayMutation.isPending} className="btn-primary">Add Holiday</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Balance Modal */}
      {showBalanceModal && balanceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Edit Leave Balance</h3>
            <p className="text-sm text-gray-500 mb-5">{balanceTarget.name} · {balanceTarget.leaveType.replace(/_/g, ' ')}</p>
            <form onSubmit={handleSubmitBalance(d => updateBalanceMutation.mutate({ userId: balanceTarget.userId, leaveType: balanceTarget.leaveType, year: new Date().getFullYear(), ...d }))} className="space-y-4">
              <div>
                <label className="label">Entitled Days *</label>
                <input {...registerBalance('entitled', { required: true, min: 0 })} type="number" className="input" min={0} />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setShowBalanceModal(false); setBalanceTarget(null); resetBalance(); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={updateBalanceMutation.isPending} className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Entitlement Modal */}
      {showBulkEntitlementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Bulk Set Leave Entitlement</h3>
            <p className="text-sm text-gray-500">Set the entitled days for <strong>all active employees</strong> for a given leave type and year.</p>
            <form onSubmit={e => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              bulkEntitlementMutation.mutate({
                leaveType: fd.get('leaveType') as string,
                year: Number(fd.get('year')),
                entitled: Number(fd.get('entitled')),
              });
            }} className="space-y-4">
              <div>
                <label className="label">Leave Type *</label>
                <select name="leaveType" required className="input">
                  {LEAVE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Year *</label>
                  <input name="year" type="number" required defaultValue={new Date().getFullYear()} className="input" />
                </div>
                <div>
                  <label className="label">Entitled Days *</label>
                  <input name="entitled" type="number" required min={0} className="input" placeholder="e.g. 14" />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowBulkEntitlementModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={bulkEntitlementMutation.isPending} className="btn-primary">
                  {bulkEntitlementMutation.isPending ? 'Setting…' : 'Set for All Employees'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Reject Leave Request</h3>
            <div className="mb-4">
              <label className="label">Reason for rejection *</label>
              <textarea value={rejectComment} onChange={e => setRejectComment(e.target.value)} className="input" rows={3} placeholder="Explain why..." />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setRejectTarget(null); setRejectComment(''); }} className="btn-secondary">Cancel</button>
              <button onClick={() => { if (rejectTarget && rejectComment.trim()) rejectMutation.mutate({ id: rejectTarget, comments: rejectComment }); }} disabled={!rejectComment.trim() || rejectMutation.isPending} className="btn-danger">Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
