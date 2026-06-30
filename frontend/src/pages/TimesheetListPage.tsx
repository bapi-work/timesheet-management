import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import { ClockIcon, ArrowUpTrayIcon, ArrowDownTrayIcon, XMarkIcon, CheckCircleIcon, ExclamationTriangleIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/auth.store';
import { hasRole, ADMIN_ROLES } from '../lib/roles';
import toast from 'react-hot-toast';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', SUBMITTED: 'badge-blue', APPROVED: 'badge-green',
  REJECTED: 'badge-red', LOCKED: 'badge-purple', IN_REVIEW: 'badge-blue',
};

function deriveDisplayStatus(timesheetStatus: string, daySubmissions: { status: string }[]): string {
  if (['LOCKED', 'APPROVED', 'SUBMITTED', 'REJECTED'].includes(timesheetStatus)) return timesheetStatus;
  if (!daySubmissions.length) return timesheetStatus;
  const hasSubmitted = daySubmissions.some(d => d.status === 'SUBMITTED');
  const hasRejected  = daySubmissions.some(d => d.status === 'REJECTED');
  const allApproved  = daySubmissions.length > 0 && daySubmissions.every(d => d.status === 'APPROVED');
  if (allApproved)  return 'APPROVED';
  if (hasRejected)  return 'REJECTED';
  if (hasSubmitted) return 'IN_REVIEW';
  return timesheetStatus;
}

// Parse server ISO date strings safely without timezone offset shifting
function formatDateStr(iso: string, fmt: string) {
  return format(parseISO(iso.slice(0, 10)), fmt);
}

const VALID_STATUSES = ['', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'LOCKED'];

type UploadResult = {
  success: boolean;
  results: { week: string; timesheetId: string; entriesAdded: number }[];
  warnings: string[];
  totalEntriesAdded: number;
};

export default function TimesheetListPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isAdmin = hasRole(user?.role, ADMIN_ROLES);
  const isManager = hasRole(user?.role, ['SYSTEM_ADMIN', 'HR_ADMIN', 'DEPARTMENT_MANAGER', 'PROJECT_MANAGER', 'TEAM_LEAD']);

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [userFilter, setUserFilter] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const params = new URLSearchParams({ page: String(page), limit: '15' });
  if (status) params.set('status', status);
  if (isManager && userFilter) params.set('userId', userFilter);

  const { data, isLoading } = useQuery({
    queryKey: ['timesheets', page, status, userFilter],
    queryFn: () => api.get(`/timesheets?${params}`).then(r => r.data),
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/users?limit=200').then(r => r.data),
    enabled: isManager,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/timesheets/${id}`),
    onSuccess: () => { toast.success('Timesheet deleted'); queryClient.invalidateQueries({ queryKey: ['timesheets'] }); },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Cannot delete timesheet'),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/timesheets/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
    onSuccess: (result: UploadResult) => {
      setUploadResult(result);
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Upload failed';
      toast.error(msg.slice(0, 200));
    },
  });

  const handleFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      toast.error('Please upload an Excel (.xlsx/.xls) or CSV file');
      return;
    }
    setUploadResult(null);
    uploadMutation.mutate(file);
  };

  const downloadTemplate = async () => {
    const r = await api.get('/timesheets/upload-template', { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url; a.download = 'timesheet-template.xlsx'; a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">
          {isAdmin ? 'All Timesheets' : isManager ? 'Timesheet History' : 'My Timesheets'}
        </h1>
        <div className="flex gap-2">
          <button onClick={() => { setShowUpload(true); setUploadResult(null); }} className="btn-secondary">
            <ArrowUpTrayIcon className="h-4 w-4" /> Upload Timesheet
          </button>
          <Link to="/timesheets/current" className="btn-primary">
            <ClockIcon className="h-4 w-4" /> Current Timesheet
          </Link>
        </div>
      </div>

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Upload Timesheet</h2>
              <button onClick={() => setShowUpload(false)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="text-sm text-gray-500 space-y-1">
              <p>Upload a CSV or Excel file with columns:</p>
              <p className="font-mono text-xs bg-gray-50 rounded p-2">
                Date | Project Code | Description | Hours | Billable | Entry Type
              </p>
              <p className="text-xs text-gray-400">Date format: YYYY-MM-DD &bull; Billable: Y or N &bull; Entry Type: REGULAR, OVERTIME, etc.</p>
            </div>

            <button onClick={downloadTemplate} className="btn-secondary btn-sm w-full">
              <ArrowDownTrayIcon className="h-4 w-4" /> Download Template
            </button>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault(); setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
              }`}
            >
              <ArrowUpTrayIcon className="h-8 w-8 mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">Drag & drop or click to select file</p>
              <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, .csv — max 10MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
              />
            </div>

            {uploadMutation.isPending && (
              <div className="flex items-center gap-2 text-sm text-primary-600">
                <div className="h-4 w-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                Uploading and processing...
              </div>
            )}

            {uploadResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircleIcon className="h-5 w-5" />
                  <span className="font-medium">{uploadResult.totalEntriesAdded} entries added successfully</span>
                </div>
                {uploadResult.results.map((r, i) => (
                  <div key={i} className="text-sm text-gray-600 bg-green-50 rounded-lg px-3 py-2">
                    Week of <strong>{r.week}</strong>: {r.entriesAdded} entries added
                    {' — '}<Link to={`/timesheets/${r.timesheetId}`} className="text-primary-600 hover:underline">View</Link>
                  </div>
                ))}
                {uploadResult.warnings.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-1 text-yellow-700 text-sm font-medium">
                      <ExclamationTriangleIcon className="h-4 w-4" /> Warnings
                    </div>
                    {uploadResult.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-yellow-600">{w}</p>
                    ))}
                  </div>
                )}
                <button onClick={() => setShowUpload(false)} className="btn-primary w-full">Done</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {VALID_STATUSES.map(s => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              status === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s || 'All'}
          </button>
        ))}

        {isManager && (
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
              {isManager && <th className="th">Employee</th>}
              <th className="th">Period</th>
              <th className="th">Total Hours</th>
              <th className="th">Billable</th>
              <th className="th">Status</th>
              <th className="th">Submitted</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="td text-center py-10">
                  <div className="h-6 w-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto" />
                </td>
              </tr>
            ) : (data?.timesheets || []).length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="td text-center text-gray-400 py-10">
                  {status ? `No ${status.toLowerCase()} timesheets found` : 'No timesheets found'}
                </td>
              </tr>
            ) : (data?.timesheets || []).map((ts: Record<string, unknown>) => {
              const u = ts.user as Record<string, unknown> | undefined;
              const daySubs = (ts.daySubmissions as { status: string }[]) || [];
              const displayStatus = deriveDisplayStatus(ts.status as string, daySubs);
              return (
                <tr key={ts.id as string} className="tr-hover">
                  {isManager && (
                    <td className="td">
                      {u ? `${u.firstName as string} ${u.lastName as string}` : '—'}
                      {u?.employeeId ? <span className="ml-1 text-xs text-gray-400">({u.employeeId as string})</span> : null}
                    </td>
                  )}
                  <td className="td font-medium">
                    {formatDateStr(ts.periodStart as string, 'MMM d')} – {formatDateStr(ts.periodEnd as string, 'MMM d, yyyy')}
                  </td>
                  <td className="td">{((ts.totalHours as number) || 0).toFixed(2)}h</td>
                  <td className="td text-green-600">{((ts.billableHours as number) || 0).toFixed(2)}h</td>
                  <td className="td">
                    <span className={STATUS_BADGE[displayStatus] || 'badge-gray'}>
                      {displayStatus === 'IN_REVIEW' ? 'In Review' : displayStatus}
                    </span>
                  </td>
                  <td className="td text-gray-400 text-xs">
                    {ts.submittedAt ? formatDateStr(ts.submittedAt as string, 'MMM d, yyyy') : '—'}
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <Link to={`/timesheets/${ts.id}`} className="text-primary-600 hover:underline text-sm">View</Link>
                      {ts.status === 'DRAFT' && !isAdmin && (
                        <button
                          onClick={() => { if (window.confirm('Delete this draft timesheet? This cannot be undone.')) deleteMutation.mutate(ts.id as string); }}
                          className="text-red-400 hover:text-red-600"
                          title="Delete draft"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(data?.total || 0) > 15 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * 15 + 1}–{Math.min(page * 15, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => p - 1)} disabled={page === 1} className="btn-secondary btn-sm">Previous</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 15 >= data.total} className="btn-secondary btn-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
