import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { CheckIcon, XMarkIcon, CheckCircleIcon, MagnifyingGlassIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';

type Tab = 'days' | 'weeks' | 'history';

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('days');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<{ id: string; type: 'day' | 'week' } | null>(null);
  const [comment, setComment] = useState('');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Teams for filter
  const { data: teamsData = [] } = useQuery({
    queryKey: ['teams-list'],
    queryFn: () => api.get('/teams').then(r => r.data?.teams || r.data || []),
  });

  // Day submissions
  const { data: dayPending = [], isLoading: dayLoading } = useQuery({
    queryKey: ['approvals', 'day-pending', teamFilter],
    queryFn: () => api.get('/approvals/day-submissions/pending', { params: teamFilter ? { teamId: teamFilter } : {} }).then(r => r.data),
  });

  // Week approvals
  const { data: weekPending = [], isLoading: weekLoading } = useQuery({
    queryKey: ['approvals', 'pending', teamFilter],
    queryFn: () => api.get('/approvals/pending', { params: teamFilter ? { teamId: teamFilter } : {} }).then(r => r.data),
  });

  // History — approved day submissions
  const { data: approvedHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ['approvals', 'day-history'],
    queryFn: () => api.get('/approvals/day-submissions/history').then(r => r.data).catch(() => []),
    enabled: tab === 'history',
  });

  const approveDayMutation = useMutation({
    mutationFn: (id: string) => api.post(`/approvals/day-submissions/${id}/approve`),
    onSuccess: () => { toast.success('Day approved!'); qc.invalidateQueries({ queryKey: ['approvals'] }); },
  });

  const rejectDayMutation = useMutation({
    mutationFn: ({ id, comments }: { id: string; comments: string }) => api.post(`/approvals/day-submissions/${id}/reject`, { comments }),
    onSuccess: () => { toast.success('Day rejected'); qc.invalidateQueries({ queryKey: ['approvals'] }); setRejectTarget(null); setComment(''); },
  });

  const approveWeekMutation = useMutation({
    mutationFn: (id: string) => api.post(`/approvals/${id}/approve`),
    onSuccess: () => { toast.success('Approved!'); qc.invalidateQueries({ queryKey: ['approvals'] }); },
  });

  const rejectWeekMutation = useMutation({
    mutationFn: ({ id, comments }: { id: string; comments: string }) => api.post(`/approvals/${id}/reject`, { comments }),
    onSuccess: () => { toast.success('Rejected'); qc.invalidateQueries({ queryKey: ['approvals'] }); setRejectTarget(null); setComment(''); },
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

  const handleReject = () => {
    if (!rejectTarget || !comment.trim()) return;
    if (rejectTarget.type === 'day') {
      rejectDayMutation.mutate({ id: rejectTarget.id, comments: comment });
    } else {
      rejectWeekMutation.mutate({ id: rejectTarget.id, comments: comment });
    }
  };

  // Collect unique departments for filter dropdown
  const allDepts = Array.from(new Set([
    ...dayPending.map((s: Record<string, unknown>) => ((s.timesheet as Record<string, unknown>)?.user as Record<string, unknown>)?.department as { name: string } | undefined),
    ...weekPending.map((a: Record<string, unknown>) => ((a.timesheet as Record<string, unknown>)?.user as Record<string, unknown>)?.department as { name: string } | undefined),
  ].filter(Boolean).map((d: { name: string } | undefined) => d?.name || ''))).filter(Boolean);

  // Filter helpers
  function filterItem(item: Record<string, unknown>) {
    const ts = item.timesheet as Record<string, unknown>;
    const user = ts?.user as Record<string, unknown>;
    const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.toLowerCase();
    const dept = (user?.department as { name: string })?.name || '';
    const matchSearch = !search || fullName.includes(search.toLowerCase());
    const matchDept = !deptFilter || dept === deptFilter;
    return matchSearch && matchDept;
  }

  const filteredDayPending = (dayPending as Record<string, unknown>[]).filter(filterItem);
  const filteredWeekPending = (weekPending as Record<string, unknown>[]).filter(filterItem);

  const dayCount = dayPending.length;
  const weekCount = weekPending.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approvals</h1>
          <p className="text-gray-500 text-sm">{dayCount + weekCount} pending</p>
        </div>
        {tab === 'weeks' && selected.size > 0 && (
          <button onClick={() => bulkApproveMutation.mutate()} disabled={bulkApproveMutation.isPending} className="btn-success">
            <CheckCircleIcon className="h-4 w-4" /> Approve Selected ({selected.size})
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(['days', 'weeks', 'history'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${tab === t ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t === 'days' ? 'Day Submissions' : t === 'weeks' ? 'Week Submissions' : 'History'}
            {t === 'days' && dayCount > 0 && <span className="ml-2 bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">{dayCount}</span>}
            {t === 'weeks' && weekCount > 0 && <span className="ml-2 bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">{weekCount}</span>}
          </button>
        ))}
      </div>

      {/* Search & filter bar — shown on pending tabs */}
      {tab !== 'history' && (
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by employee name…"
              className="input pl-9 w-full"
            />
          </div>
          {allDepts.length > 0 && (
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="input w-auto">
              <option value="">All departments</option>
              {allDepts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {(teamsData as { id: string; name: string }[]).length > 0 && (
            <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="input w-auto">
              <option value="">All teams</option>
              {(teamsData as { id: string; name: string }[]).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {(search || deptFilter || teamFilter) && (
            <button onClick={() => { setSearch(''); setDeptFilter(''); setTeamFilter(''); }} className="btn-secondary btn-sm">Clear</button>
          )}
        </div>
      )}

      {/* Day Submissions Tab */}
      {tab === 'days' && (
        <>
          {dayLoading ? (
            <div className="flex items-center justify-center h-32"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : filteredDayPending.length === 0 ? (
            <div className="card text-center py-16">
              <CheckCircleIcon className="h-12 w-12 text-green-400 mx-auto mb-3" />
              <p className="text-gray-500">{dayPending.length === 0 ? 'No pending day submissions.' : 'No results match your search.'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDayPending.map((sub: Record<string, unknown>) => {
                const ts = sub.timesheet as Record<string, unknown>;
                const user = ts.user as Record<string, unknown>;
                const dayEntries = (sub.dayEntries as Record<string, unknown>[]) || [];
                const dayHours = dayEntries.reduce((s: number, e: Record<string, unknown>) => s + (e.hours as number), 0);
                const isExpanded = expandedId === (sub.id as string);

                return (
                  <div key={sub.id as string} className="card p-0 overflow-hidden">
                    <div className="flex items-center gap-4 p-4">
                      <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center text-sm font-bold text-primary-700 flex-shrink-0">
                        {(user.firstName as string)?.[0]}{(user.lastName as string)?.[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900">{user.firstName as string} {user.lastName as string}</p>
                          <span className="text-gray-400">·</span>
                          <p className="text-sm text-gray-500">{(user.department as { name: string })?.name}</p>
                        </div>
                        <p className="text-sm text-gray-600">
                          <strong>{format(new Date(sub.date as string), 'EEEE, MMM d, yyyy')}</strong>
                          <span className="ml-2 font-medium">{dayHours.toFixed(2)}h</span>
                          <span className="ml-2 text-gray-400 text-xs">submitted {format(new Date(sub.submittedAt as string), 'MMM d, h:mm a')}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : sub.id as string)}
                          className="btn-secondary btn-sm"
                          title="View timesheet details"
                        >
                          {isExpanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                          Details
                        </button>
                        <button onClick={() => approveDayMutation.mutate(sub.id as string)} disabled={approveDayMutation.isPending} className="btn-success btn-sm">
                          <CheckIcon className="h-4 w-4" /> Approve
                        </button>
                        <button onClick={() => setRejectTarget({ id: sub.id as string, type: 'day' })} className="btn-danger btn-sm">
                          <XMarkIcon className="h-4 w-4" /> Reject
                        </button>
                      </div>
                    </div>

                    {/* Compact entry pills */}
                    {dayEntries.length > 0 && !isExpanded && (
                      <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                        <div className="flex flex-wrap gap-2">
                          {dayEntries.map((e: Record<string, unknown>) => (
                            <span key={e.id as string} className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1">
                              {(e.project as { name: string })?.name || 'General'}
                              {(e.task as { name: string })?.name ? ` · ${(e.task as { name: string }).name}` : ''}
                              {' · '}{(e.hours as number).toFixed(2)}h
                              {e.isBillable ? ' · 💰' : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Expanded detail view (#24) */}
                    {isExpanded && (
                      <div className="border-t border-gray-200 bg-gray-50">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase">
                              <th className="text-left px-4 py-2">Project</th>
                              <th className="text-left px-4 py-2">Task</th>
                              <th className="text-left px-4 py-2">Category</th>
                              <th className="text-left px-4 py-2">Description</th>
                              <th className="text-right px-4 py-2">Hours</th>
                              <th className="text-left px-4 py-2">Billable</th>
                              <th className="text-left px-4 py-2">Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dayEntries.map((e: Record<string, unknown>) => (
                              <tr key={e.id as string} className="border-b border-gray-100 last:border-0">
                                <td className="px-4 py-2 font-medium">{(e.project as { name: string })?.name || '—'}</td>
                                <td className="px-4 py-2 text-gray-500">{(e.task as { name: string })?.name || '—'}</td>
                                <td className="px-4 py-2 text-gray-500">{(e.category as string) || '—'}</td>
                                <td className="px-4 py-2 text-gray-500 max-w-xs break-words">{(e.description as string) || '—'}</td>
                                <td className="px-4 py-2 text-right font-semibold">{(e.hours as number).toFixed(2)}h</td>
                                <td className="px-4 py-2">
                                  {e.isBillable
                                    ? <span className="badge-green text-xs">Yes</span>
                                    : <span className="badge-gray text-xs">No</span>}
                                </td>
                                <td className="px-4 py-2 text-gray-500 capitalize text-xs">{(e.entryType as string)?.toLowerCase().replace('_', ' ')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Week Submissions Tab */}
      {tab === 'weeks' && (
        <>
          {weekLoading ? (
            <div className="flex items-center justify-center h-32"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : filteredWeekPending.length === 0 ? (
            <div className="card text-center py-16">
              <CheckCircleIcon className="h-12 w-12 text-green-400 mx-auto mb-3" />
              <p className="text-gray-500">{weekPending.length === 0 ? 'No pending week approvals.' : 'No results match your search.'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredWeekPending.map((approval: Record<string, unknown>) => {
                const ts = approval.timesheet as Record<string, unknown>;
                const user = ts.user as Record<string, unknown>;
                const isDue = !!(approval.dueDate && new Date(approval.dueDate as string) < new Date());
                const isExpanded = expandedId === (approval.id as string);
                const tsEntries = (ts.entries as Record<string, unknown>[]) || [];

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
                          <span className="ml-2 font-medium">{(ts.totalHours as number)?.toFixed(2)}h total</span>
                          {(ts.overtimeHours as number) > 0 && <span className="ml-1 text-orange-600">({(ts.overtimeHours as number)?.toFixed(2)}h OT)</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : approval.id as string)}
                          className="btn-secondary btn-sm"
                        >
                          {isExpanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                          Details
                        </button>
                        <button onClick={() => approveWeekMutation.mutate(approval.id as string)} disabled={approveWeekMutation.isPending} className="btn-success btn-sm">
                          <CheckIcon className="h-4 w-4" /> Approve
                        </button>
                        <button onClick={() => setRejectTarget({ id: approval.id as string, type: 'week' })} className="btn-danger btn-sm">
                          <XMarkIcon className="h-4 w-4" /> Reject
                        </button>
                      </div>
                    </div>

                    {isExpanded && tsEntries.length > 0 && (
                      <div className="border-t border-gray-200 bg-gray-50">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase">
                              <th className="text-left px-4 py-2">Date</th>
                              <th className="text-left px-4 py-2">Project</th>
                              <th className="text-left px-4 py-2">Task</th>
                              <th className="text-left px-4 py-2">Description</th>
                              <th className="text-right px-4 py-2">Hours</th>
                              <th className="text-left px-4 py-2">Billable</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tsEntries.map((e: Record<string, unknown>) => (
                              <tr key={e.id as string} className="border-b border-gray-100 last:border-0">
                                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{format(new Date(e.date as string), 'EEE MMM d')}</td>
                                <td className="px-4 py-2 font-medium">{(e.project as { name: string })?.name || '—'}</td>
                                <td className="px-4 py-2 text-gray-500">{(e.task as { name: string })?.name || '—'}</td>
                                <td className="px-4 py-2 text-gray-500 max-w-xs break-words">{(e.description as string) || '—'}</td>
                                <td className="px-4 py-2 text-right font-semibold">{(e.hours as number).toFixed(2)}h</td>
                                <td className="px-4 py-2">
                                  {e.isBillable
                                    ? <span className="badge-green text-xs">Yes</span>
                                    : <span className="badge-gray text-xs">No</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* History Tab (#22) */}
      {tab === 'history' && (
        <>
          {/* Employee search filter for history */}
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter by employee name…"
                className="input pl-9 w-full"
              />
            </div>
            {search && <button onClick={() => setSearch('')} className="btn-secondary btn-sm">Clear</button>}
          </div>
          {historyLoading ? (
            <div className="flex items-center justify-center h-32"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : (approvedHistory as unknown[]).length === 0 ? (
            <div className="card text-center py-16">
              <p className="text-gray-500">No approved submissions yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(approvedHistory as Record<string, unknown>[]).filter(filterItem).map((sub) => {
                const ts = sub.timesheet as Record<string, unknown>;
                const user = ts.user as Record<string, unknown>;
                const dayEntries = (sub.dayEntries as Record<string, unknown>[]) || [];
                const dayHours = dayEntries.reduce((s: number, e: Record<string, unknown>) => s + (e.hours as number), 0);
                const isExpanded = expandedId === (sub.id as string);

                return (
                  <div key={sub.id as string} className="card p-0 overflow-hidden border-green-200">
                    <div className="flex items-center gap-4 p-4">
                      <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-sm font-bold text-green-700 flex-shrink-0">
                        {(user.firstName as string)?.[0]}{(user.lastName as string)?.[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900">{user.firstName as string} {user.lastName as string}</p>
                          <span className="text-gray-400">·</span>
                          <p className="text-sm text-gray-500">{(user.department as { name: string })?.name}</p>
                          <span className="badge-green text-xs">Approved</span>
                        </div>
                        <p className="text-sm text-gray-600">
                          <strong>{format(new Date(sub.date as string), 'EEEE, MMM d, yyyy')}</strong>
                          <span className="ml-2 font-medium">{dayHours.toFixed(2)}h</span>
                          {!!sub.reviewedAt && (
                            <span className="ml-2 text-gray-400 text-xs">approved {format(new Date(sub.reviewedAt as string), 'MMM d, h:mm a')}</span>
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : sub.id as string)}
                        className="btn-secondary btn-sm"
                      >
                        {isExpanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
                        Details
                      </button>
                    </div>

                    {isExpanded && dayEntries.length > 0 && (
                      <div className="border-t border-gray-200 bg-gray-50">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase">
                              <th className="text-left px-4 py-2">Project</th>
                              <th className="text-left px-4 py-2">Task</th>
                              <th className="text-left px-4 py-2">Description</th>
                              <th className="text-right px-4 py-2">Hours</th>
                              <th className="text-left px-4 py-2">Billable</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dayEntries.map((e: Record<string, unknown>) => (
                              <tr key={e.id as string} className="border-b border-gray-100 last:border-0">
                                <td className="px-4 py-2 font-medium">{(e.project as { name: string })?.name || '—'}</td>
                                <td className="px-4 py-2 text-gray-500">{(e.task as { name: string })?.name || '—'}</td>
                                <td className="px-4 py-2 text-gray-500 max-w-xs break-words">{(e.description as string) || '—'}</td>
                                <td className="px-4 py-2 text-right font-semibold">{(e.hours as number).toFixed(2)}h</td>
                                <td className="px-4 py-2">
                                  {e.isBillable
                                    ? <span className="badge-green text-xs">Yes</span>
                                    : <span className="badge-gray text-xs">No</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Reject Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              Reject {rejectTarget.type === 'day' ? 'Day' : 'Week'} Timesheet
            </h3>
            <div className="mb-4">
              <label className="label">Reason for rejection *</label>
              <textarea value={comment} onChange={e => setComment(e.target.value)} className="input" rows={3} placeholder="Explain why this timesheet is being rejected..." />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setRejectTarget(null); setComment(''); }} className="btn-secondary">Cancel</button>
              <button
                onClick={handleReject}
                disabled={!comment.trim() || rejectDayMutation.isPending || rejectWeekMutation.isPending}
                className="btn-danger"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
