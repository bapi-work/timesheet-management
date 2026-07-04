import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { PlusIcon, CalendarDaysIcon, TrashIcon, PaperClipIcon, ArrowDownTrayIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/auth.store';
import { ADMIN_ROLES, hasRole } from '../lib/roles';

function exportLeaveCSV(requests: Record<string, unknown>[], filename: string) {
  const rows = [
    ['Employee', 'Leave Type', 'Start Date', 'End Date', 'Days', 'Day Type', 'Status', 'Reason', 'Approver', 'Comments'],
    ...requests.map(r => {
      const u = r.user as { firstName: string; lastName: string } | undefined;
      const approver = r.approver as { firstName: string; lastName: string } | undefined;
      return [
        u ? `${u.firstName} ${u.lastName}` : '',
        r.leaveType as string,
        format(new Date(r.startDate as string), 'yyyy-MM-dd'),
        format(new Date(r.endDate as string), 'yyyy-MM-dd'),
        String(r.days),
        r.dayType as string,
        r.status as string,
        (r.reason as string) || '',
        approver ? `${approver.firstName} ${approver.lastName}` : '',
        (r.approverComments as string) || '',
      ];
    }),
  ];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const LEAVE_COLORS: Record<string, string> = {
  ANNUAL: 'badge-blue', SICK: 'badge-red', MATERNITY: 'badge-purple',
  PATERNITY: 'badge-purple', UNPAID: 'badge-gray', COMPENSATORY: 'badge-green', OTHER: 'badge-yellow',
};

const ALL_LEAVE_TYPES = ['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'UNPAID', 'COMPENSATORY', 'OTHER'];

// Filter leave types based on employee gender — MATERNITY for females only, PATERNITY for males only
function getLeaveTypesForUser(gender?: string) {
  if (gender === 'MALE') return ALL_LEAVE_TYPES.filter(t => t !== 'MATERNITY');
  if (gender === 'FEMALE') return ALL_LEAVE_TYPES.filter(t => t !== 'PATERNITY');
  return ALL_LEAVE_TYPES;
}

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
  const [showAddBalanceModal, setShowAddBalanceModal] = useState(false);
  const [adminDeptFilter, setAdminDeptFilter] = useState('');
  const [adminDateFrom, setAdminDateFrom] = useState('');
  const [adminDateTo, setAdminDateTo] = useState('');
  const [balanceSearch, setBalanceSearch] = useState('');
  const [balanceDeptFilter, setBalanceDeptFilter] = useState('');
  const [expandedEmployees, setExpandedEmployees] = useState<Set<string>>(new Set());
  const { register: registerAddBalance, handleSubmit: handleSubmitAddBalance, reset: resetAddBalance } = useForm();

  const { register, handleSubmit, reset, formState: { errors } } = useForm();
  const docInputRef = useRef<HTMLInputElement>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const { register: registerHoliday, handleSubmit: handleSubmitHoliday, reset: resetHoliday } = useForm();
  const { register: registerBalance, handleSubmit: handleSubmitBalance, reset: resetBalance, setValue } = useForm();

  const isHrAdmin = hasRole(user?.role, ADMIN_ROLES);
  const canSeeTeamLeave = isHrAdmin || user?.role === 'DEPARTMENT_MANAGER' || user?.role === 'PROJECT_MANAGER' || user?.role === 'TEAM_LEAD';
  const LEAVE_TYPES = getLeaveTypesForUser(user?.gender);

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

  const { data: departments = [] } = useQuery({
    queryKey: ['departments-list'],
    queryFn: () => api.get('/departments').then(r => Array.isArray(r.data) ? r.data : (r.data.departments || [])),
    enabled: isHrAdmin,
  });

  const { data: allUsersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users?limit=200').then(r => r.data),
    enabled: isHrAdmin,
  });

  const addBalanceMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/leave/balances', data),
    onSuccess: () => { toast.success('Balance added'); qc.invalidateQueries({ queryKey: ['leave', 'all-balances'] }); setShowAddBalanceModal(false); resetAddBalance(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
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
        const res = await api.post('/leave/upload-doc', fd);
        documentUrl = res.data.url;
      } catch (e) {
        const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to upload document';
        toast.error(msg);
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

          {/* Stats summary */}
          {(() => {
            const all = teamRequests as Record<string, unknown>[];
            const pending = all.filter(r => r.status === 'PENDING').length;
            const approved = all.filter(r => r.status === 'APPROVED').length;
            const rejected = all.filter(r => r.status === 'REJECTED').length;
            const totalDays = all.filter(r => r.status === 'APPROVED').reduce((s, r) => s + (r.days as number), 0);
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Pending Approval', value: pending, color: 'bg-yellow-500' },
                  { label: 'Approved', value: approved, color: 'bg-green-500' },
                  { label: 'Rejected', value: rejected, color: 'bg-red-500' },
                  { label: 'Total Days Approved', value: totalDays.toFixed(1), color: 'bg-blue-500' },
                ].map(card => (
                  <div key={card.label} className="card">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-lg ${card.color} flex-shrink-0`} />
                      <div>
                        <p className="text-xs text-gray-500">{card.label}</p>
                        <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* All Leave Requests */}
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="font-semibold text-gray-900">All Leave Requests</h2>
              <button
                onClick={() => exportLeaveCSV(
                  (teamRequests as Record<string, unknown>[]).filter(r =>
                    (!adminDeptFilter || (r.user as { departmentId?: string } | undefined)?.departmentId === adminDeptFilter) &&
                    (!statusFilter || r.status === statusFilter)
                  ),
                  `leave-requests-${format(new Date(), 'yyyy-MM-dd')}.csv`
                )}
                className="btn-secondary btn-sm flex items-center gap-1.5"
              >
                <ArrowDownTrayIcon className="h-4 w-4" /> Export CSV
              </button>
            </div>

            {/* Filters row */}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex gap-2 flex-wrap">
                {['', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {s || 'All'}
                  </button>
                ))}
              </div>

              {(departments as { id: string; name: string }[]).length > 0 && (
                <select
                  value={adminDeptFilter}
                  onChange={e => setAdminDeptFilter(e.target.value)}
                  className="input ml-auto"
                >
                  <option value="">All Departments</option>
                  {(departments as { id: string; name: string }[]).map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              )}

              <div className="flex items-center gap-2">
                <input type="date" value={adminDateFrom} onChange={e => setAdminDateFrom(e.target.value)} className="input" placeholder="From" />
                <span className="text-gray-400">–</span>
                <input type="date" value={adminDateTo} onChange={e => setAdminDateTo(e.target.value)} className="input" placeholder="To" />
                {(adminDateFrom || adminDateTo) && (
                  <button onClick={() => { setAdminDateFrom(''); setAdminDateTo(''); }} className="text-xs text-red-500 hover:underline whitespace-nowrap">Clear</button>
                )}
              </div>
            </div>

            {(() => {
              const filtered = (teamRequests as Record<string, unknown>[]).filter(r => {
                if (statusFilter && r.status !== statusFilter) return false;
                if (adminDateFrom && new Date(r.startDate as string) < new Date(adminDateFrom)) return false;
                if (adminDateTo && new Date(r.endDate as string) > new Date(adminDateTo)) return false;
                return true;
              });
              if (filtered.length === 0) return <div className="card text-center py-10 text-gray-400">No leave requests match filters</div>;
              return filtered.map(req => renderRequest(req, true, true));
            })()}
          </div>

          {/* Leave Balances Management — Employee-centric view */}
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-semibold text-gray-900">Employee Leave Balances — {new Date().getFullYear()}</h2>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setShowAddBalanceModal(true)} className="btn-secondary btn-sm flex items-center gap-1.5">
                  <UserPlusIcon className="h-4 w-4" /> Add Balance
                </button>
                <button onClick={() => setShowBulkEntitlementModal(true)} className="btn-secondary btn-sm">
                  Bulk Set Entitlement
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="text"
                value={balanceSearch}
                onChange={e => setBalanceSearch(e.target.value)}
                className="input max-w-xs"
                placeholder="Search employee..."
              />
              {(departments as { id: string; name: string }[]).length > 0 && (
                <select value={balanceDeptFilter} onChange={e => setBalanceDeptFilter(e.target.value)} className="input max-w-xs">
                  <option value="">All Departments</option>
                  {(departments as { id: string; name: string }[]).map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              )}
              {(balanceSearch || balanceDeptFilter) && (
                <button onClick={() => { setBalanceSearch(''); setBalanceDeptFilter(''); }} className="text-xs text-red-500 hover:underline">Clear filters</button>
              )}
            </div>

            {(() => {
              const allUsers: Record<string, unknown>[] = (allUsersData as { users?: Record<string, unknown>[] } | undefined)?.users || [];
              // Build balance lookup: userId -> leaveType -> balance record
              const balanceMap = new Map<string, Map<string, Record<string, unknown>>>();
              for (const b of allBalances as Record<string, unknown>[]) {
                const uid = b.userId as string;
                if (!balanceMap.has(uid)) balanceMap.set(uid, new Map());
                balanceMap.get(uid)!.set(b.leaveType as string, b);
              }

              const filteredUsers = allUsers.filter(u => {
                if (u.role === 'SYSTEM_ADMIN') return false;
                if (balanceDeptFilter && (u.department as { id: string } | undefined)?.id !== balanceDeptFilter) return false;
                if (balanceSearch) {
                  const name = `${u.firstName} ${u.lastName} ${u.employeeId || ''}`.toLowerCase();
                  if (!name.includes(balanceSearch.toLowerCase())) return false;
                }
                return true;
              });

              if (filteredUsers.length === 0) {
                return <div className="card text-center py-8 text-gray-400">No employees found</div>;
              }

              return (
                <div className="space-y-3">
                  {filteredUsers.map(u => {
                    const uid = u.id as string;
                    const userBalances = balanceMap.get(uid);
                    const isExpanded = expandedEmployees.has(uid);
                    const toggleExpand = () => setExpandedEmployees(prev => {
                      const next = new Set(prev);
                      if (next.has(uid)) next.delete(uid); else next.add(uid);
                      return next;
                    });

                    // Compute totals
                    let totalEntitled = 0, totalUsed = 0, totalPending = 0;
                    for (const lt of ALL_LEAVE_TYPES) {
                      const b = userBalances?.get(lt);
                      if (b) {
                        totalEntitled += (b.entitled as number) || 0;
                        totalUsed += (b.used as number) || 0;
                        totalPending += (b.pending as number) || 0;
                      }
                    }
                    const totalRemaining = totalEntitled - totalUsed - totalPending;
                    const dept = u.department as { name: string } | undefined;

                    return (
                      <div key={uid} className="card p-0 overflow-hidden">
                        {/* Employee header row */}
                        <button
                          onClick={toggleExpand}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                              {(u.firstName as string)[0]}{(u.lastName as string)[0]}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{u.firstName as string} {u.lastName as string}</p>
                              <p className="text-xs text-gray-400">{(u.employeeId as string) || ''}{dept ? ` · ${dept.name}` : ''}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-6 text-sm">
                            <div className="text-center hidden sm:block">
                              <p className="text-xs text-gray-400">Entitled</p>
                              <p className="font-semibold text-gray-700">{totalEntitled}</p>
                            </div>
                            <div className="text-center hidden sm:block">
                              <p className="text-xs text-gray-400">Used</p>
                              <p className="font-semibold text-gray-700">{totalUsed}</p>
                            </div>
                            <div className="text-center hidden sm:block">
                              <p className="text-xs text-gray-400">Pending</p>
                              <p className="font-semibold text-orange-500">{totalPending || '—'}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-xs text-gray-400">Remaining</p>
                              <p className={`font-bold ${totalRemaining < 0 ? 'text-red-600' : totalRemaining === 0 && totalEntitled > 0 ? 'text-orange-500' : 'text-green-600'}`}>{totalRemaining}</p>
                            </div>
                            <svg className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </div>
                        </button>

                        {/* Per-leave-type breakdown */}
                        {isExpanded && (
                          <div className="border-t border-gray-100">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="th text-left pl-4">Leave Type</th>
                                  <th className="th text-center">Entitled</th>
                                  <th className="th text-center">Pending</th>
                                  <th className="th text-center">Used</th>
                                  <th className="th text-center">Remaining</th>
                                  <th className="th"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {ALL_LEAVE_TYPES.map(lt => {
                                  const b = userBalances?.get(lt);
                                  const entitled = (b?.entitled as number) || 0;
                                  const used = (b?.used as number) || 0;
                                  const pending = (b?.pending as number) || 0;
                                  const remaining = entitled - used - pending;
                                  const hasRecord = !!b;
                                  return (
                                    <tr key={lt} className="hover:bg-gray-50/50">
                                      <td className="td pl-4">
                                        <span className={LEAVE_COLORS[lt] || 'badge-gray'}>{lt.replace(/_/g, ' ')}</span>
                                      </td>
                                      <td className="td text-center">{hasRecord ? entitled : <span className="text-gray-300">—</span>}</td>
                                      <td className="td text-center">{hasRecord ? (pending > 0 ? <span className="text-orange-500 font-medium">{pending}</span> : '0') : <span className="text-gray-300">—</span>}</td>
                                      <td className="td text-center">{hasRecord ? used : <span className="text-gray-300">—</span>}</td>
                                      <td className="td text-center">
                                        {hasRecord
                                          ? <span className={remaining < 0 ? 'text-red-600 font-semibold' : remaining === 0 ? 'text-orange-500' : 'text-green-600 font-medium'}>{remaining}</span>
                                          : <span className="text-gray-300">—</span>
                                        }
                                      </td>
                                      <td className="td">
                                        <div className="flex gap-1 justify-end">
                                          {hasRecord ? (
                                            <>
                                              <button
                                                onClick={() => openBalanceModal(uid, `${u.firstName} ${u.lastName}`, lt, entitled)}
                                                className="btn-secondary btn-sm"
                                              >Edit</button>
                                              <button
                                                onClick={() => { if (window.confirm('Delete this balance record?')) deleteBalanceMutation.mutate(b!.id as string); }}
                                                className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                                              ><TrashIcon className="h-3.5 w-3.5" /></button>
                                            </>
                                          ) : (
                                            <button
                                              onClick={() => openBalanceModal(uid, `${u.firstName} ${u.lastName}`, lt, 0)}
                                              className="text-xs text-primary-600 hover:underline px-2 py-1"
                                            >+ Set</button>
                                          )}
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
                    );
                  })}
                </div>
              );
            })()}
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
                  {ALL_LEAVE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
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

      {/* Add Balance Modal */}
      {showAddBalanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Add Leave Balance</h3>
            <p className="text-sm text-gray-500">Set or create a leave balance entry for an employee.</p>
            <form onSubmit={handleSubmitAddBalance(d => addBalanceMutation.mutate({ ...d as Record<string, unknown>, year: new Date().getFullYear() }))} className="space-y-4">
              <div>
                <label className="label">Employee *</label>
                <select {...registerAddBalance('userId', { required: true })} className="input">
                  <option value="">Select employee</option>
                  {(allUsersData?.users || []).map((u: Record<string, unknown>) => (
                    <option key={u.id as string} value={u.id as string}>{u.firstName as string} {u.lastName as string}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Leave Type *</label>
                <select {...registerAddBalance('leaveType', { required: true })} className="input">
                  <option value="">Select type</option>
                  {ALL_LEAVE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Entitled Days *</label>
                <input {...registerAddBalance('entitled', { required: true, min: 0, valueAsNumber: true })} type="number" min={0} className="input" placeholder="e.g. 14" />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setShowAddBalanceModal(false); resetAddBalance(); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={addBalanceMutation.isPending} className="btn-primary">
                  {addBalanceMutation.isPending ? 'Saving…' : 'Save Balance'}
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
