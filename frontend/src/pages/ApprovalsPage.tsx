import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { CheckIcon, XMarkIcon, CheckCircleIcon, ClockIcon } from '@heroicons/react/24/outline';

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: () => api.get('/approvals/pending').then(r => r.data),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/approvals/${id}/approve`),
    onSuccess: () => { toast.success('Approved!'); qc.invalidateQueries({ queryKey: ['approvals'] }); },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, comments }: { id: string; comments: string }) => api.post(`/approvals/${id}/reject`, { comments }),
    onSuccess: () => { toast.success('Rejected'); qc.invalidateQueries({ queryKey: ['approvals'] }); setRejectId(null); setComment(''); },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: () => api.post('/approvals/bulk-approve', { approvalIds: Array.from(selected) }),
    onSuccess: (r) => {
      toast.success(`Approved ${r.data.succeeded} timesheets`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });

  const toggleSelect = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approvals</h1>
          <p className="text-gray-500 text-sm">{pending.length} pending</p>
        </div>
        {selected.size > 0 && (
          <button onClick={() => bulkApproveMutation.mutate()} disabled={bulkApproveMutation.isPending} className="btn-success">
            <CheckCircleIcon className="h-4 w-4" /> Approve Selected ({selected.size})
          </button>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="card text-center py-16">
          <CheckCircleIcon className="h-12 w-12 text-green-400 mx-auto mb-3" />
          <p className="text-gray-500">All caught up! No pending approvals.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((approval: Record<string, unknown>) => {
            const ts = approval.timesheet as Record<string, unknown>;
            const user = ts.user as Record<string, unknown>;
            const isDue = !!(approval.dueDate && new Date(approval.dueDate as string) < new Date());

            return (
              <div key={approval.id as string} className={`card p-0 overflow-hidden ${isDue ? 'border-orange-200' : ''}`}>
                <div className="flex items-center gap-4 p-4">
                  <input type="checkbox" checked={selected.has(approval.id as string)} onChange={() => toggleSelect(approval.id as string)} className="rounded h-4 w-4" />

                  <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center text-sm font-bold text-primary-700 flex-shrink-0">
                    {(user.firstName as string)?.[0]}{(user.lastName as string)?.[0]}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900">{user.firstName as string} {user.lastName as string}</p>
                      <span className="text-gray-400">·</span>
                      <p className="text-sm text-gray-500">{(user.department as { name: string })?.name}</p>
                      {isDue && <span className="badge-red">Overdue</span>}
                    </div>
                    <p className="text-sm text-gray-600">
                      {format(new Date(ts.periodStart as string), 'MMM d')} – {format(new Date(ts.periodEnd as string), 'MMM d, yyyy')}
                      <span className="ml-2 font-medium">{(ts.totalHours as number)?.toFixed(1)}h total</span>
                      {(ts.overtimeHours as number) > 0 && <span className="ml-1 text-orange-600">({(ts.overtimeHours as number)?.toFixed(1)}h OT)</span>}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-400">{(ts.entries as unknown[])?.length || 0} entries</span>
                    <button onClick={() => approveMutation.mutate(approval.id as string)} disabled={approveMutation.isPending} className="btn-success btn-sm">
                      <CheckIcon className="h-4 w-4" /> Approve
                    </button>
                    <button onClick={() => setRejectId(approval.id as string)} className="btn-danger btn-sm">
                      <XMarkIcon className="h-4 w-4" /> Reject
                    </button>
                  </div>
                </div>

                {/* Entries summary */}
                {(ts.entries as unknown[])?.length > 0 && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                    <div className="flex flex-wrap gap-2">
                      {((ts.entries as Record<string, unknown>[]).slice(0, 5)).map((e) => (
                        <span key={e.id as string} className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1">
                          {(e.project as { name: string })?.name || 'General'} · {(e.hours as number).toFixed(1)}h
                        </span>
                      ))}
                      {(ts.entries as unknown[]).length > 5 && (
                        <span className="text-xs text-gray-400">+{(ts.entries as unknown[]).length - 5} more</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Modal */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Reject Timesheet</h3>
            <div className="mb-4">
              <label className="label">Reason for rejection *</label>
              <textarea value={comment} onChange={e => setComment(e.target.value)} className="input" rows={3} placeholder="Explain why this timesheet is being rejected..." />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setRejectId(null); setComment(''); }} className="btn-secondary">Cancel</button>
              <button onClick={() => rejectMutation.mutate({ id: rejectId, comments: comment })} disabled={!comment.trim() || rejectMutation.isPending} className="btn-danger">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
