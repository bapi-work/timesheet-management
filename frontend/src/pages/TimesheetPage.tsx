import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { format, eachDayOfInterval, isWeekend } from 'date-fns';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  PlusIcon, TrashIcon, PaperAirplaneIcon, ArrowPathIcon,
  ClipboardDocumentListIcon, LockClosedIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: 'Draft',     cls: 'badge-gray' },
  SUBMITTED: { label: 'Submitted', cls: 'badge-blue' },
  APPROVED:  { label: 'Approved',  cls: 'badge-green' },
  REJECTED:  { label: 'Rejected',  cls: 'badge-red' },
  LOCKED:    { label: 'Locked',    cls: 'badge-purple' },
};

export default function TimesheetPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [addingDay, setAddingDay] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const url = id === 'current' || !id ? '/timesheets/current' : `/timesheets/${id}`;

  const { data: timesheet, isLoading } = useQuery({
    queryKey: ['timesheet', id],
    queryFn: () => api.get(url).then(r => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects?limit=100').then(r => r.data.projects),
  });

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/timesheets/${timesheet?.id}/submit`),
    onSuccess: () => { toast.success('Timesheet submitted!'); qc.invalidateQueries({ queryKey: ['timesheet'] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const copyPrevMutation = useMutation({
    mutationFn: () => api.post(`/timesheets/${timesheet?.id}/copy-previous`),
    onSuccess: () => { toast.success('Previous week copied!'); qc.invalidateQueries({ queryKey: ['timesheet'] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'No previous timesheet'),
  });

  const deleteEntry = useMutation({
    mutationFn: (entryId: string) => api.delete(`/timesheets/${timesheet?.id}/entries/${entryId}`),
    onSuccess: () => { toast.success('Entry removed'); qc.invalidateQueries({ queryKey: ['timesheet'] }); },
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (!timesheet) return <div className="card text-center py-12 text-gray-500">Timesheet not found</div>;

  const days = eachDayOfInterval({ start: new Date(timesheet.periodStart), end: new Date(timesheet.periodEnd) });
  const canEdit = ['DRAFT', 'REJECTED'].includes(timesheet.status);
  const statusConfig = STATUS_CONFIG[timesheet.status] || { label: timesheet.status, cls: 'badge-gray' };

  const getEntriesForDay = (date: Date) =>
    (timesheet.entries || []).filter((e: { date: string }) =>
      format(new Date(e.date), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')
    );

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Timesheet</h1>
          <p className="text-gray-500 text-sm mt-1">
            {format(new Date(timesheet.periodStart), 'MMM d')} – {format(new Date(timesheet.periodEnd), 'MMM d, yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={statusConfig.cls}>{statusConfig.label}</span>
          {canEdit && (
            <>
              <button onClick={() => copyPrevMutation.mutate()} disabled={copyPrevMutation.isPending} className="btn-secondary">
                <ClipboardDocumentListIcon className="h-4 w-4" /> Copy Previous Week
              </button>
              <button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending || !timesheet.totalHours} className="btn-primary">
                <PaperAirplaneIcon className="h-4 w-4" /> Submit
              </button>
            </>
          )}
          {timesheet.status === 'LOCKED' && <LockClosedIcon className="h-5 w-5 text-gray-400" />}
        </div>
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Hours', value: `${timesheet.totalHours.toFixed(1)}h` },
          { label: 'Billable', value: `${timesheet.billableHours.toFixed(1)}h` },
          { label: 'Overtime', value: `${timesheet.overtimeHours.toFixed(1)}h` },
        ].map(s => (
          <div key={s.label} className="card text-center py-4">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Approval Info */}
      {timesheet.approvals?.length > 0 && (
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3">Approval Status</h3>
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
            const isAdding = addingDay === format(day, 'yyyy-MM-dd');

            return (
              <div key={day.toISOString()} className={clsx('px-6 py-4', isWknd && 'bg-gray-50')}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className={clsx('text-center w-10', isWknd && 'opacity-50')}>
                      <p className="text-xs text-gray-500">{format(day, 'EEE')}</p>
                      <p className="text-lg font-bold text-gray-900">{format(day, 'd')}</p>
                    </div>
                    {dayTotal > 0 && (
                      <span className={clsx('text-sm font-semibold', dayTotal >= 8 ? 'text-green-600' : 'text-orange-600')}>
                        {dayTotal.toFixed(1)}h
                      </span>
                    )}
                  </div>
                  {canEdit && !isAdding && (
                    <button onClick={() => setAddingDay(format(day, 'yyyy-MM-dd'))} className="btn-secondary btn-sm">
                      <PlusIcon className="h-3.5 w-3.5" /> Add Entry
                    </button>
                  )}
                </div>

                {entries.map((entry: Record<string, unknown>) => (
                  <div key={entry.id as string} className="flex items-center gap-3 ml-13 pl-13 mb-2 group">
                    <div className="flex-1 flex items-center gap-4 bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {(entry.project as { name: string })?.name || 'General'}
                          {(entry.task as { name: string })?.name && <span className="text-gray-500"> · {(entry.task as { name: string }).name}</span>}
                        </p>
                        {!!entry.description && <p className="text-xs text-gray-500 truncate">{entry.description as string}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!!entry.isBillable && <span className="badge-green text-xs">Billable</span>}
                        <span className="font-semibold text-gray-900">{(entry.hours as number).toFixed(1)}h</span>
                      </div>
                    </div>
                    {canEdit && (
                      <button onClick={() => deleteEntry.mutate(entry.id as string)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-red-400 hover:bg-red-50 hover:text-red-600 transition-all">
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}

                {isAdding && (
                  <div className="ml-13 mt-2">
                    <AddEntryForm
                      timesheetId={timesheet.id}
                      date={format(day, 'yyyy-MM-dd')}
                      projects={projects || []}
                      onDone={() => { setAddingDay(null); qc.invalidateQueries({ queryKey: ['timesheet'] }); }}
                      onCancel={() => setAddingDay(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface Project {
  id: string;
  name: string;
  tasks?: { id: string; name: string }[];
}

function AddEntryForm({ timesheetId, date, projects, onDone, onCancel }: {
  timesheetId: string; date: string; projects: Project[];
  onDone: () => void; onCancel: () => void;
}) {
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: { projectId: '', taskId: '', description: '', hours: 8, isBillable: true, entryType: 'REGULAR' },
  });
  const [isLoading, setIsLoading] = useState(false);
  const selectedProject = projects.find((p: Project) => p.id === watch('projectId'));

  const onSubmit = async (data: Record<string, unknown>) => {
    setIsLoading(true);
    try {
      await api.post(`/timesheets/${timesheetId}/entries`, [{
        ...data,
        projectId: data.projectId || undefined,
        taskId: data.taskId || undefined,
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
          <select {...register('projectId')} className="input">
            <option value="">No project</option>
            {projects.map((p: Project) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Task</label>
          <select {...register('taskId')} className="input" disabled={!selectedProject?.tasks?.length}>
            <option value="">No task</option>
            {(selectedProject?.tasks || []).map((t: { id: string; name: string }) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="label">Description</label>
          <input {...register('description')} className="input" placeholder="What did you work on?" />
        </div>
        <div>
          <label className="label">Hours *</label>
          <input {...register('hours', { required: true, min: 0.25, max: 24 })} type="number" step="0.25" className={`input ${errors.hours ? 'input-error' : ''}`} />
        </div>
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
