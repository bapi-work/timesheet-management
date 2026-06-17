import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { format, eachDayOfInterval, isWeekend, startOfWeek, endOfWeek, addWeeks, eachDayOfInterval as eachDay } from 'date-fns';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  PlusIcon, TrashIcon, PaperAirplaneIcon,
  ClipboardDocumentListIcon, LockClosedIcon,
  ChevronLeftIcon, ChevronRightIcon, ArrowUturnLeftIcon,
  PencilIcon, CheckIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const ENTRY_CATEGORIES = [
  'Deliverables',
  'Project Management',
  'Software Development',
  'Self Development',
  'Project Support',
  'Project Implementation',
  'Other',
];

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: 'Draft',     cls: 'badge-gray' },
  SUBMITTED: { label: 'Submitted', cls: 'badge-blue' },
  APPROVED:  { label: 'Approved',  cls: 'badge-green' },
  REJECTED:  { label: 'Rejected',  cls: 'badge-red' },
  LOCKED:    { label: 'Locked',    cls: 'badge-purple' },
  WITHDRAWN: { label: 'Withdrawn', cls: 'badge-gray' },
  IN_REVIEW: { label: 'In Review', cls: 'badge-blue' },
};

const DAY_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  SUBMITTED: { label: 'Pending Approval', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  APPROVED:  { label: 'Approved',         cls: 'bg-green-50 text-green-700 border border-green-200' },
  REJECTED:  { label: 'Rejected',         cls: 'bg-red-50 text-red-700 border border-red-200' },
  WITHDRAWN: { label: 'Withdrawn',        cls: 'bg-gray-50 text-gray-500 border border-gray-200' },
};

interface DaySubmission {
  id: string;
  date: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  comments?: string;
}

interface Project {
  id: string;
  name: string;
  billable?: boolean;
  tasks?: { id: string; name: string; isBillable: boolean }[];
}

interface EntryFormValues {
  projectId: string;
  taskId: string;
  description: string;
  category: string;
  hours: number;
  isBillable: boolean;
  entryType: string;
}

// Derive a meaningful display status from day-level submissions
function deriveDisplayStatus(timesheetStatus: string, daySubmissions: DaySubmission[]): string {
  if (['LOCKED', 'APPROVED'].includes(timesheetStatus)) return timesheetStatus;
  if (!daySubmissions.length) return timesheetStatus;
  const hasSubmitted = daySubmissions.some(d => d.status === 'SUBMITTED');
  const hasRejected  = daySubmissions.some(d => d.status === 'REJECTED');
  const allApproved  = daySubmissions.every(d => d.status === 'APPROVED');
  if (allApproved) return 'APPROVED';
  if (hasRejected)  return 'REJECTED';
  if (hasSubmitted) return 'IN_REVIEW';
  return timesheetStatus;
}

// Confirmation dialog helper
function useConfirm() {
  return (message: string): Promise<boolean> =>
    new Promise(resolve => resolve(window.confirm(message)));
}

export default function TimesheetPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [addingDay, setAddingDay] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  const isCurrent = id === 'current' || !id;
  const weekBase = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const url = isCurrent
    ? `/timesheets/current?week=${format(weekBase, 'yyyy-MM-dd')}`
    : `/timesheets/${id}`;

  const { data: timesheet, isLoading } = useQuery({
    queryKey: ['timesheet', id, weekOffset],
    queryFn: () => api.get(url).then(r => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects?limit=100').then(r => r.data.projects),
  });

  // Fetch approved leave for leave-day indicators
  const { data: leaveData } = useQuery({
    queryKey: ['leave-week', weekOffset],
    queryFn: () => timesheet
      ? api.get('/leave', {
          params: {
            startDate: timesheet.periodStart,
            endDate: timesheet.periodEnd,
          },
        }).then(r => r.data).catch(() => ({ requests: [] }))
      : Promise.resolve({ requests: [] }),
    enabled: !!timesheet,
  });

  const approvedLeaveDays = new Set<string>();
  const leaveRequests: Array<{ startDate: string; endDate: string; leaveType: string; status: string }> =
    leaveData?.requests || [];
  leaveRequests
    .filter(l => l.status === 'APPROVED')
    .forEach(l => {
      eachDay({ start: new Date(l.startDate), end: new Date(l.endDate) })
        .forEach(d => approvedLeaveDays.add(format(d, 'yyyy-MM-dd')));
    });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['timesheet', id, weekOffset] });

  const copyPrevMutation = useMutation({
    mutationFn: () => api.post(`/timesheets/${timesheet?.id}/copy-previous`),
    onSuccess: () => { toast.success('Previous week copied!'); invalidate(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'No previous timesheet'),
  });

  const deleteEntry = useMutation({
    mutationFn: (entryId: string) => api.delete(`/timesheets/${timesheet?.id}/entries/${entryId}`),
    onSuccess: () => { toast.success('Entry removed'); invalidate(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const updateEntry = useMutation({
    mutationFn: ({ entryId, data }: { entryId: string; data: Partial<EntryFormValues> }) =>
      api.put(`/timesheets/${timesheet?.id}/entries/${entryId}`, data),
    onSuccess: () => { toast.success('Entry updated'); setEditingEntryId(null); invalidate(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const submitDay = useMutation({
    mutationFn: (date: string) => api.post(`/timesheets/${timesheet?.id}/days/${date}/submit`),
    onSuccess: () => { toast.success('Day submitted for approval!'); invalidate(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const withdrawDay = useMutation({
    mutationFn: (date: string) => api.post(`/timesheets/${timesheet?.id}/days/${date}/withdraw`),
    onSuccess: () => { toast.success('Submission withdrawn'); invalidate(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  // Bulk submit: submit all draft days that have entries
  const submitAllDraftDays = async () => {
    if (!timesheet) return;
    const draftDays = days.filter(day => {
      const dateKey = format(day, 'yyyy-MM-dd');
      const entries = getEntriesForDay(day);
      const daySub = getDaySubmission(day);
      return entries.length > 0 && (!daySub || daySub.status === 'REJECTED') && !isWeekend(day);
    });
    if (!draftDays.length) { toast('No draft days to submit'); return; }
    const ok = await confirm(`Submit all ${draftDays.length} draft day(s) for approval?`);
    if (!ok) return;
    for (const day of draftDays) {
      await api.post(`/timesheets/${timesheet.id}/days/${format(day, 'yyyy-MM-dd')}/submit`).catch(() => {});
    }
    toast.success(`${draftDays.length} day(s) submitted!`);
    invalidate();
  };

  const handleDeleteEntry = async (entryId: string) => {
    const ok = await confirm('Delete this time entry? This cannot be undone.');
    if (ok) deleteEntry.mutate(entryId);
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (!timesheet) return <div className="card text-center py-12 text-gray-500">Timesheet not found</div>;

  const days = eachDayOfInterval({ start: new Date(timesheet.periodStart), end: new Date(timesheet.periodEnd) });
  const timesheetLocked = ['APPROVED', 'LOCKED'].includes(timesheet.status);

  const daySubmissions: DaySubmission[] = timesheet.daySubmissions || [];
  const displayStatus = deriveDisplayStatus(timesheet.status, daySubmissions);
  const statusConfig = STATUS_CONFIG[displayStatus] || { label: displayStatus, cls: 'badge-gray' };

  const getDaySubmission = (date: Date): DaySubmission | undefined =>
    daySubmissions.find(ds =>
      format(new Date(ds.date), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    );

  const getEntriesForDay = (date: Date) =>
    (timesheet.entries || []).filter((e: { date: string }) =>
      format(new Date(e.date), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    );

  const totalDaysSubmitted = daySubmissions.filter(ds => ds.status === 'SUBMITTED').length;
  const totalDaysApproved  = daySubmissions.filter(ds => ds.status === 'APPROVED').length;

  const hasDraftDaysToSubmit = days.some(day => {
    const entries = getEntriesForDay(day);
    const daySub = getDaySubmission(day);
    return entries.length > 0 && (!daySub || daySub.status === 'REJECTED') && !isWeekend(day);
  });

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Timesheet</h1>
          {isCurrent ? (
            <div className="flex items-center gap-2 mt-1">
              <button onClick={() => { setWeekOffset(w => w - 1); setAddingDay(null); setEditingEntryId(null); }} className="p-1 rounded hover:bg-gray-100 text-gray-500">
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <span className="text-gray-500 text-sm">
                {format(new Date(timesheet.periodStart), 'MMM d')} – {format(new Date(timesheet.periodEnd), 'MMM d, yyyy')}
                {weekOffset === 0 && <span className="ml-1.5 text-xs text-primary-600 font-medium">(This week)</span>}
              </span>
              {/* Only allow navigating to past weeks — future weeks are disallowed (#23) */}
              <button
                onClick={() => { setWeekOffset(w => w + 1); setAddingDay(null); setEditingEntryId(null); }}
                disabled={weekOffset >= 0}
                className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed"
                title={weekOffset >= 0 ? 'Cannot add entries to future weeks' : 'Next week'}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
              {weekOffset !== 0 && (
                <button onClick={() => { setWeekOffset(0); setAddingDay(null); setEditingEntryId(null); }} className="text-xs text-primary-600 underline">Today</button>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm mt-1">
              {format(new Date(timesheet.periodStart), 'MMM d')} – {format(new Date(timesheet.periodEnd), 'MMM d, yyyy')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={statusConfig.cls}>{statusConfig.label}</span>
          {!timesheetLocked && hasDraftDaysToSubmit && (
            <button onClick={submitAllDraftDays} className="btn-primary">
              <PaperAirplaneIcon className="h-4 w-4" /> Submit Week
            </button>
          )}
          {!timesheetLocked && (
            <button onClick={() => copyPrevMutation.mutate()} disabled={copyPrevMutation.isPending} className="btn-secondary">
              <ClipboardDocumentListIcon className="h-4 w-4" /> Copy Previous Week
            </button>
          )}
          {timesheet.status === 'LOCKED' && <LockClosedIcon className="h-5 w-5 text-gray-400" />}
        </div>
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Hours', value: `${timesheet.totalHours.toFixed(2)}h` },
          { label: 'Billable', value: `${timesheet.billableHours.toFixed(2)}h` },
          { label: 'Pending Approval', value: `${totalDaysSubmitted} day${totalDaysSubmitted !== 1 ? 's' : ''}`, highlight: totalDaysSubmitted > 0 },
          { label: 'Approved Days', value: `${totalDaysApproved} day${totalDaysApproved !== 1 ? 's' : ''}`, success: totalDaysApproved > 0 },
        ].map(s => (
          <div key={s.label} className="card text-center py-4">
            <p className={clsx('text-2xl font-bold', s.highlight ? 'text-blue-600' : s.success ? 'text-green-600' : 'text-gray-900')}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Approval Info (week-level) */}
      {timesheet.approvals?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3">Week Approval Status</h3>
          <div className="space-y-2">
            {timesheet.approvals.map((a: Record<string, unknown>) => (
              <div key={a.id as string} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium">{(a.approver as { firstName: string; lastName: string })?.firstName} {(a.approver as { firstName: string; lastName: string })?.lastName}</p>
                  {!!a.comments && <p className="text-xs text-gray-500 mt-0.5">"{a.comments as string}"</p>}
                </div>
                <span className={a.status === 'APPROVED' ? 'badge-green' : a.status === 'REJECTED' ? 'badge-red' : 'badge-yellow'}>
                  {a.status as string}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily Entries */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Time Entries</h3>
          <span className="text-sm text-gray-500">{timesheet.entries?.length || 0} entries</span>
        </div>

        <div className="divide-y divide-gray-100">
          {days.map(day => {
            const entries = getEntriesForDay(day);
            const dayTotal = entries.reduce((s: number, e: { hours: number }) => s + e.hours, 0);
            const isWknd = isWeekend(day);
            const dateKey = format(day, 'yyyy-MM-dd');
            const isAdding = addingDay === dateKey;
            const daySub = getDaySubmission(day);
            const isDayApproved  = daySub?.status === 'APPROVED';
            const isDaySubmitted = daySub?.status === 'SUBMITTED';
            const isDayRejected  = daySub?.status === 'REJECTED';
            const isLeaveDay     = approvedLeaveDays.has(dateKey);

            const dayEditable = !timesheetLocked && !isDayApproved;

            return (
              <div
                key={day.toISOString()}
                className={clsx(
                  'px-6 py-4',
                  isWknd && 'bg-gray-50',
                  isDayApproved && 'bg-green-50/40',
                  isLeaveDay && !isDayApproved && 'bg-orange-50/40',
                )}
              >
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className={clsx('text-center w-10', isWknd && !isDayApproved && 'opacity-50')}>
                      <p className="text-xs text-gray-500">{format(day, 'EEE')}</p>
                      <p className={clsx('text-lg font-bold', isDayApproved ? 'text-green-700' : isLeaveDay ? 'text-orange-600' : 'text-gray-900')}>{format(day, 'd')}</p>
                    </div>
                    {dayTotal > 0 && (
                      <span className={clsx('text-sm font-semibold', dayTotal >= 8 ? 'text-green-600' : 'text-orange-600')}>
                        {dayTotal.toFixed(2)}h
                      </span>
                    )}
                    {/* Leave indicator */}
                    {isLeaveDay && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700 border border-orange-200">
                        🏖 On Leave
                      </span>
                    )}
                    {/* Day status badge */}
                    {daySub && (
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', DAY_STATUS_CONFIG[daySub.status]?.cls)}>
                        {DAY_STATUS_CONFIG[daySub.status]?.label}
                      </span>
                    )}
                    {isDayRejected && daySub?.comments && (
                      <span className="text-xs text-red-600 italic">"{daySub.comments}"</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {dayEditable && !isDaySubmitted && entries.length > 0 && (
                      <button
                        onClick={() => submitDay.mutate(dateKey)}
                        disabled={submitDay.isPending}
                        className="btn-primary btn-sm"
                        title="Submit this day for approval"
                      >
                        <PaperAirplaneIcon className="h-3.5 w-3.5" />
                        {isDayRejected ? 'Resubmit' : 'Submit Day'}
                      </button>
                    )}
                    {isDaySubmitted && (
                      <button
                        onClick={() => withdrawDay.mutate(dateKey)}
                        disabled={withdrawDay.isPending}
                        className="btn-secondary btn-sm"
                        title="Withdraw submission"
                      >
                        <ArrowUturnLeftIcon className="h-3.5 w-3.5" /> Withdraw
                      </button>
                    )}
                    {dayEditable && !isAdding && editingEntryId === null && (
                      <button onClick={() => setAddingDay(dateKey)} className="btn-secondary btn-sm">
                        <PlusIcon className="h-3.5 w-3.5" /> Add Entry
                      </button>
                    )}
                    {isDayApproved && (
                      <LockClosedIcon className="h-4 w-4 text-green-500" title="Day approved — locked" />
                    )}
                  </div>
                </div>

                {/* Entries list */}
                {entries.map((entry: Record<string, unknown>) => (
                  <div key={entry.id as string} className="mb-2">
                    {editingEntryId === entry.id ? (
                      <EditEntryForm
                        entry={entry}
                        projects={projects || []}
                        onSave={(data) => updateEntry.mutate({ entryId: entry.id as string, data })}
                        onCancel={() => setEditingEntryId(null)}
                        isLoading={updateEntry.isPending}
                      />
                    ) : (
                      <div className="flex items-start gap-3 group">
                        <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 break-words">
                                {(entry.project as { name: string })?.name || 'General'}
                                {(entry.task as { name: string })?.name && <span className="text-gray-500"> · {(entry.task as { name: string }).name}</span>}
                              </p>
                              {!!(entry.category) && (
                                <p className="text-xs text-primary-600 font-medium mt-0.5">{entry.category as string}</p>
                              )}
                              {!!entry.description && (
                                <p className="text-xs text-gray-500 break-words whitespace-pre-wrap mt-0.5">{entry.description as string}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              {!!entry.isBillable && <span className="badge-green text-xs">Billable</span>}
                              <span className="font-semibold text-gray-900">{(entry.hours as number).toFixed(2)}h</span>
                            </div>
                          </div>
                        </div>
                        {dayEditable && (
                          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button
                              onClick={() => { setEditingEntryId(entry.id as string); setAddingDay(null); }}
                              className="p-1.5 rounded text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                              title="Edit entry"
                            >
                              <PencilIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteEntry(entry.id as string)}
                              className="p-1.5 rounded text-red-400 hover:bg-red-50 hover:text-red-600"
                              title="Delete entry"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {isAdding && (
                  <div className="mt-2">
                    <AddEntryForm
                      timesheetId={timesheet.id}
                      date={dateKey}
                      projects={projects || []}
                      onDone={() => { setAddingDay(null); invalidate(); }}
                      onCancel={() => setAddingDay(null)}
                    />
                  </div>
                )}

                {entries.length === 0 && !isAdding && !isWknd && !isLeaveDay && (
                  <p className="text-xs text-gray-400 pl-2">No entries</p>
                )}
                {entries.length === 0 && !isAdding && isLeaveDay && (
                  <p className="text-xs text-orange-400 pl-2">Leave day — no timesheet entries required</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Help text */}
      <div className="text-xs text-gray-400 space-y-0.5">
        <p>• Add time entries to each day, then click <strong>Submit Day</strong> or <strong>Submit Week</strong> to send for approval.</p>
        <p>• Hover over an entry to reveal edit and delete buttons.</p>
        <p>• Click <strong>Withdraw</strong> to cancel a pending submission and make changes.</p>
        <p>• Hours are tracked to 2 decimal places in 0.25 increments.</p>
      </div>
    </div>
  );
}

/* ─── Edit Entry Form ─────────────────────────────────────────────────────── */
function EditEntryForm({
  entry, projects, onSave, onCancel, isLoading,
}: {
  entry: Record<string, unknown>;
  projects: Project[];
  onSave: (data: Partial<EntryFormValues>) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<EntryFormValues>({
    defaultValues: {
      projectId: (entry.project as { id: string })?.id || '',
      taskId: (entry.task as { id: string })?.id || '',
      description: (entry.description as string) || '',
      category: (entry.category as string) || '',
      hours: entry.hours as number,
      isBillable: entry.isBillable as boolean,
      entryType: (entry.entryType as string) || 'REGULAR',
    },
  });

  const selectedProject = projects.find(p => p.id === watch('projectId'));

  // Auto-set billable from task (#14)
  const handleTaskChange = (taskId: string) => {
    const task = selectedProject?.tasks?.find(t => t.id === taskId);
    if (task) setValue('isBillable', task.isBillable);
    else if (selectedProject) setValue('isBillable', selectedProject.billable ?? true);
  };

  return (
    <form
      onSubmit={handleSubmit(data => onSave({
        ...data,
        projectId: data.projectId || undefined,
        taskId: data.taskId || undefined,
        hours: Number(data.hours),
      }))}
      className="bg-white border border-blue-200 rounded-xl p-4 space-y-3"
    >
      <p className="text-xs font-semibold text-blue-700 mb-1">Editing Entry</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Project</label>
          <select {...register('projectId')} className="input">
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Task</label>
          <select {...register('taskId')} className="input" disabled={!selectedProject?.tasks?.length}
            onChange={e => { register('taskId').onChange(e); handleTaskChange(e.target.value); }}>
            <option value="">No task</option>
            {(selectedProject?.tasks || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Category</label>
          <select {...register('category')} className="input">
            <option value="">Select category</option>
            {ENTRY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Hours *</label>
          <input
            {...register('hours', { required: true, min: 0.25, max: 24 })}
            type="number" step="0.25"
            className={`input ${errors.hours ? 'input-error' : ''}`}
          />
          {errors.hours && <p className="text-xs text-red-500 mt-0.5">Min 0.25h, max 24h</p>}
        </div>
      </div>
      <div>
        <label className="label">Description</label>
        <textarea {...register('description')} className="input" rows={2} placeholder="What did you work on?" />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input {...register('isBillable')} type="checkbox" className="rounded" />
          <span className="text-sm">Billable</span>
        </label>
        <select {...register('entryType')} className="input w-auto">
          <option value="REGULAR">Regular</option>
          <option value="OVERTIME">Overtime</option>
          <option value="COMP_OFF">Comp Off</option>
          <option value="ON_CALL">On Call</option>
        </select>
        <div className="flex-1" />
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">
          <XMarkIcon className="h-3.5 w-3.5" /> Cancel
        </button>
        <button type="submit" disabled={isLoading} className="btn-primary btn-sm">
          <CheckIcon className="h-3.5 w-3.5" /> {isLoading ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/* ─── Add Entry Form ──────────────────────────────────────────────────────── */
function AddEntryForm({ timesheetId, date, projects, onDone, onCancel }: {
  timesheetId: string; date: string; projects: Project[];
  onDone: () => void; onCancel: () => void;
}) {
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<EntryFormValues>({
    defaultValues: { projectId: '', taskId: '', description: '', category: '', hours: 8, isBillable: true, entryType: 'REGULAR' },
  });
  const [isLoading, setIsLoading] = useState(false);
  const selectedProject = projects.find(p => p.id === watch('projectId'));

  // Auto-set billable from project when project changes (#14)
  const handleProjectChange = (projectId: string) => {
    const proj = projects.find(p => p.id === projectId);
    if (proj) setValue('isBillable', proj.billable ?? true);
    setValue('taskId', '');
  };

  // Auto-set billable from task (#14)
  const handleTaskChange = (taskId: string) => {
    const task = selectedProject?.tasks?.find(t => t.id === taskId);
    if (task) setValue('isBillable', task.isBillable);
  };

  const onSubmit = async (data: EntryFormValues) => {
    setIsLoading(true);
    try {
      await api.post(`/timesheets/${timesheetId}/entries`, [{
        ...data,
        projectId: data.projectId || undefined,
        taskId: data.taskId || undefined,
        category: data.category || undefined,
        date,
        hours: Number(data.hours),
      }]);
      onDone();
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to add entry');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Project</label>
          <select
            {...register('projectId')}
            className="input"
            onChange={e => { register('projectId').onChange(e); handleProjectChange(e.target.value); }}
          >
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Task</label>
          <select
            {...register('taskId')}
            className="input"
            disabled={!selectedProject?.tasks?.length}
            onChange={e => { register('taskId').onChange(e); handleTaskChange(e.target.value); }}
          >
            <option value="">No task</option>
            {(selectedProject?.tasks || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Category</label>
          <select {...register('category')} className="input">
            <option value="">Select category</option>
            {ENTRY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Hours *</label>
          <input
            {...register('hours', { required: true, min: 0.25, max: 24 })}
            type="number" step="0.25"
            className={`input ${errors.hours ? 'input-error' : ''}`}
          />
          {errors.hours && <p className="text-xs text-red-500 mt-0.5">Min 0.25h (quarter-hour increments)</p>}
        </div>
      </div>
      <div>
        <label className="label">Description</label>
        <textarea {...register('description')} className="input" rows={2} placeholder="What did you work on?" />
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input {...register('isBillable')} type="checkbox" className="rounded" />
          <span className="text-sm">Billable</span>
        </label>
        <select {...register('entryType')} className="input w-auto">
          <option value="REGULAR">Regular</option>
          <option value="OVERTIME">Overtime</option>
          <option value="COMP_OFF">Comp Off</option>
          <option value="ON_CALL">On Call</option>
        </select>
        <div className="flex-1" />
        <button type="button" onClick={onCancel} className="btn-secondary btn-sm">Cancel</button>
        <button type="submit" disabled={isLoading} className="btn-primary btn-sm">
          {isLoading ? 'Saving...' : 'Add Entry'}
        </button>
      </div>
    </form>
  );
}
