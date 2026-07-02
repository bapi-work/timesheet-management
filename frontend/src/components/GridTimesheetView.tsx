import { useState, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  format, eachDayOfInterval, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, addMonths, parseISO, isWeekend,
} from 'date-fns';
import { PlusIcon, TrashIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import api from '../lib/api';
import toast from 'react-hot-toast';

interface Project {
  id: string;
  name: string;
  billable?: boolean;
  tasks?: { id: string; name: string; isBillable: boolean }[];
}

interface GridRow {
  key: string;
  projectId: string;
  taskId: string;
  description: string;
  category: string;
  isBillable: boolean;
  entryType: string;
  hours: Record<string, number>;    // dateKey → hours
  entryIds: Record<string, string>; // dateKey → entryId
  tsIds: Record<string, string>;    // dateKey → timesheetId
}

interface TimesheetEntry {
  id: string;
  date: string;
  hours: number;
  isBillable: boolean;
  projectId?: string;
  taskId?: string;
  description?: string;
  category?: string;
  entryType: string;
  project?: { id: string; name: string };
  task?: { id: string; name: string };
}

interface Timesheet {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  entries: TimesheetEntry[];
}

const ENTRY_CATEGORIES = [
  'Deliverables', 'Project Management', 'Software Development',
  'Self Development', 'Project Support', 'Project Implementation', 'Other',
];

function hoursToHHMM(hours: number): string {
  if (!hours) return '';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function HHMMToHours(val: string): number {
  if (!val) return 0;
  if (val.includes(':')) {
    const [h, m] = val.split(':').map(Number);
    return (h || 0) + (m || 0) / 60;
  }
  return parseFloat(val) || 0;
}

function rowKey(e: TimesheetEntry): string {
  return [e.projectId || '', e.taskId || '', e.category || '', e.isBillable ? '1' : '0', e.entryType || 'REGULAR'].join('|');
}

function buildRows(timesheets: Timesheet[]): GridRow[] {
  const map = new Map<string, GridRow>();
  for (const ts of timesheets) {
    for (const e of ts.entries) {
      const key = rowKey(e);
      const dateKey = e.date.slice(0, 10);
      if (!map.has(key)) {
        map.set(key, {
          key,
          projectId: e.projectId || '',
          taskId: e.taskId || '',
          description: e.description || '',
          category: e.category || '',
          isBillable: e.isBillable,
          entryType: e.entryType || 'REGULAR',
          hours: {},
          entryIds: {},
          tsIds: {},
        });
      }
      const row = map.get(key)!;
      row.hours[dateKey] = (row.hours[dateKey] || 0) + e.hours;
      row.entryIds[dateKey] = e.id;
      row.tsIds[dateKey] = ts.id;
    }
  }
  return Array.from(map.values());
}

function emptyRow(): GridRow {
  return {
    key: `new-${Date.now()}-${Math.random()}`,
    projectId: '', taskId: '', description: '',
    category: '', isBillable: true, entryType: 'REGULAR',
    hours: {}, entryIds: {}, tsIds: {},
  };
}

interface Props {
  mode: 'weekly' | 'monthly';
  projects: Project[];
  weekBase: Date; // used for weekly mode (current week from parent)
}

export default function GridTimesheetView({ mode, projects, weekBase }: Props) {
  const qc = useQueryClient();
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [rows, setRows] = useState<GridRow[]>([emptyRow()]);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const timesheetMapRef = useRef<Map<string, Timesheet>>(new Map()); // periodStart → timesheet

  const rangeStart = mode === 'weekly'
    ? startOfWeek(weekBase, { weekStartsOn: 0 })
    : startOfMonth(monthDate);
  const rangeEnd = mode === 'weekly'
    ? endOfWeek(weekBase, { weekStartsOn: 0 })
    : endOfMonth(monthDate);

  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

  const queryKey = ['grid-timesheets', mode, format(rangeStart, 'yyyy-MM-dd')];

  const { isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data } = await api.get('/timesheets', {
        params: {
          from: format(rangeStart, 'yyyy-MM-dd'),
          to: format(rangeEnd, 'yyyy-MM-dd'),
          limit: 10,
        },
      });
      const sheets: Timesheet[] = data.timesheets || [];
      timesheetMapRef.current = new Map(
        sheets.map(ts => [ts.periodStart.slice(0, 10), ts])
      );
      const built = buildRows(sheets);
      setRows(built.length ? [...built, emptyRow()] : [emptyRow()]);
      return sheets;
    },
  });

  const getOrCreateTimesheet = useCallback(async (date: Date): Promise<Timesheet> => {
    const weekStart = startOfWeek(date, { weekStartsOn: 0 });
    const weekKey = format(weekStart, 'yyyy-MM-dd');
    if (timesheetMapRef.current.has(weekKey)) {
      return timesheetMapRef.current.get(weekKey)!;
    }
    const { data } = await api.get(`/timesheets/current?week=${weekKey}`);
    timesheetMapRef.current.set(weekKey, data);
    return data;
  }, []);

  const saveCell = useCallback(async (row: GridRow, dateKey: string, hours: number) => {
    if (!row.projectId) { toast.error('Select a project first'); return; }
    const cellKey = `${row.key}|${dateKey}`;
    setSaving(s => new Set(s).add(cellKey));
    try {
      const date = parseISO(dateKey);
      const ts = await getOrCreateTimesheet(date);
      const existingEntryId = row.entryIds[dateKey];

      if (hours <= 0) {
        if (existingEntryId) {
          await api.delete(`/timesheets/${ts.id}/entries/${existingEntryId}`);
          setRows(prev => prev.map(r => {
            if (r.key !== row.key) return r;
            const h = { ...r.hours }; delete h[dateKey];
            const ei = { ...r.entryIds }; delete ei[dateKey];
            return { ...r, hours: h, entryIds: ei };
          }));
        }
      } else if (existingEntryId) {
        await api.put(`/timesheets/${ts.id}/entries/${existingEntryId}`, {
          hours, projectId: row.projectId, taskId: row.taskId || undefined,
          description: row.description || undefined, category: row.category || undefined,
          isBillable: row.isBillable, entryType: row.entryType,
        });
        setRows(prev => prev.map(r => r.key === row.key ? { ...r, hours: { ...r.hours, [dateKey]: hours }, tsIds: { ...r.tsIds, [dateKey]: ts.id } } : r));
      } else {
        const { data: entry } = await api.post(`/timesheets/${ts.id}/entries`, [{
          date: dateKey, hours,
          projectId: row.projectId, taskId: row.taskId || undefined,
          description: row.description || undefined, category: row.category || undefined,
          isBillable: row.isBillable, entryType: row.entryType,
        }]);
        const newId = Array.isArray(entry) ? entry[0]?.id : entry?.id;
        setRows(prev => prev.map(r => r.key === row.key
          ? { ...r, hours: { ...r.hours, [dateKey]: hours }, entryIds: { ...r.entryIds, [dateKey]: newId }, tsIds: { ...r.tsIds, [dateKey]: ts.id } }
          : r));
      }
      qc.invalidateQueries({ queryKey: ['timesheet'] });
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(cellKey); return n; });
    }
  }, [getOrCreateTimesheet, qc]);

  const deleteRow = useCallback(async (row: GridRow) => {
    const entryDates = Object.keys(row.entryIds);
    for (const dateKey of entryDates) {
      try {
        const ts = timesheetMapRef.current.get(
          format(startOfWeek(parseISO(dateKey), { weekStartsOn: 0 }), 'yyyy-MM-dd')
        );
        if (ts) await api.delete(`/timesheets/${ts.id}/entries/${row.entryIds[dateKey]}`);
      } catch {}
    }
    setRows(prev => prev.filter(r => r.key !== row.key));
    qc.invalidateQueries({ queryKey: ['timesheet'] });
  }, [qc]);

  const addRow = () => setRows(prev => [...prev, emptyRow()]);

  const updateRowMeta = (key: string, field: keyof GridRow, value: unknown) => {
    setRows(prev => prev.map(r => r.key === key ? { ...r, [field]: value } : r));
  };

  const dayTotals = days.reduce<Record<string, number>>((acc, day) => {
    const dk = format(day, 'yyyy-MM-dd');
    acc[dk] = rows.reduce((s, r) => s + (r.hours[dk] || 0), 0);
    return acc;
  }, {});

  const totalHours = Object.values(dayTotals).reduce((s, h) => s + h, 0);

  if (isLoading) return <div className="flex items-center justify-center h-32"><div className="h-6 w-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-3">
      {/* Month navigation (monthly mode only) */}
      {mode === 'monthly' && (
        <div className="flex items-center gap-3">
          <button onClick={() => setMonthDate(d => startOfMonth(addMonths(d, -1)))} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <span className="font-semibold text-gray-800 text-sm">{format(monthDate, 'MMMM yyyy')}</span>
          <button
            onClick={() => setMonthDate(d => startOfMonth(addMonths(d, 1)))}
            disabled={format(addMonths(monthDate, 1), 'yyyy-MM') > format(new Date(), 'yyyy-MM')}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-30"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="sticky left-0 z-10 bg-gray-50 text-left px-3 py-2 font-semibold text-gray-600 border-r border-gray-200 min-w-[160px]">Project</th>
              <th className="text-left px-3 py-2 font-semibold text-gray-600 border-r border-gray-200 min-w-[140px]">Task</th>
              <th className="text-left px-3 py-2 font-semibold text-gray-600 border-r border-gray-200 min-w-[120px]">Category</th>
              <th className="text-center px-2 py-2 font-semibold text-gray-600 border-r border-gray-200 w-20">Billable</th>
              {days.map(day => {
                const wknd = isWeekend(day);
                return (
                  <th key={format(day, 'yyyy-MM-dd')} className={clsx('text-center px-1 py-2 font-semibold text-gray-600 border-r border-gray-200 min-w-[64px]', wknd && 'bg-gray-100')}>
                    <div className="text-xs text-gray-400 font-normal">{format(day, 'EEE')}</div>
                    <div>{format(day, 'd')}{mode === 'monthly' && <span className="text-xs text-gray-400 font-normal ml-0.5">{format(day, 'MMM')}</span>}</div>
                  </th>
                );
              })}
              <th className="text-center px-2 py-2 font-semibold text-gray-600 border-r border-gray-200 w-16">Total</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const rowTotal = days.reduce((s, d) => s + (row.hours[format(d, 'yyyy-MM-dd')] || 0), 0);
              const selectedProject = projects.find(p => p.id === row.projectId);
              const isLastRow = ri === rows.length - 1;

              return (
                <tr key={row.key} className={clsx('border-b border-gray-100 hover:bg-blue-50/20', isLastRow && 'bg-blue-50/10')}>
                  {/* Project */}
                  <td className="sticky left-0 z-10 bg-white px-2 py-1.5 border-r border-gray-200">
                    <select
                      value={row.projectId}
                      onChange={e => {
                        const proj = projects.find(p => p.id === e.target.value);
                        updateRowMeta(row.key, 'projectId', e.target.value);
                        updateRowMeta(row.key, 'isBillable', proj?.billable ?? true);
                        updateRowMeta(row.key, 'taskId', '');
                      }}
                      className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                    >
                      <option value="">Select…</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>

                  {/* Task */}
                  <td className="px-2 py-1.5 border-r border-gray-200">
                    <select
                      value={row.taskId}
                      onChange={e => {
                        const task = selectedProject?.tasks?.find(t => t.id === e.target.value);
                        updateRowMeta(row.key, 'taskId', e.target.value);
                        if (task) updateRowMeta(row.key, 'isBillable', task.isBillable);
                      }}
                      disabled={!selectedProject?.tasks?.length}
                      className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white disabled:bg-gray-50 disabled:text-gray-400"
                    >
                      <option value="">Select…</option>
                      {(selectedProject?.tasks || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>

                  {/* Category */}
                  <td className="px-2 py-1.5 border-r border-gray-200">
                    <select
                      value={row.category}
                      onChange={e => updateRowMeta(row.key, 'category', e.target.value)}
                      className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                    >
                      <option value="">Select…</option>
                      {ENTRY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>

                  {/* Billable */}
                  <td className="px-2 py-1.5 border-r border-gray-200 text-center">
                    <input
                      type="checkbox"
                      checked={row.isBillable}
                      onChange={e => updateRowMeta(row.key, 'isBillable', e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>

                  {/* Day cells */}
                  {days.map(day => {
                    const dk = format(day, 'yyyy-MM-dd');
                    const wknd = isWeekend(day);
                    const cellKey = `${row.key}|${dk}`;
                    const isSavingCell = saving.has(cellKey);

                    return (
                      <td key={dk} className={clsx('px-1 py-1.5 border-r border-gray-200 text-center', wknd && 'bg-gray-50')}>
                        <input
                          type="text"
                          placeholder="00:00"
                          defaultValue={row.hours[dk] ? hoursToHHMM(row.hours[dk]) : ''}
                          key={`${row.key}-${dk}-${row.hours[dk]}`}
                          disabled={wknd || isSavingCell}
                          className={clsx(
                            'w-14 text-center text-xs border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400',
                            wknd ? 'bg-gray-50 border-transparent text-gray-300 cursor-not-allowed' : 'border-gray-200 bg-white',
                            isSavingCell && 'opacity-50',
                            row.hours[dk] && 'font-medium text-blue-700 border-blue-200',
                          )}
                          onBlur={e => {
                            const hours = HHMMToHours(e.target.value);
                            const prev = row.hours[dk] || 0;
                            if (Math.abs(hours - prev) > 0.01) saveCell(row, dk, hours);
                          }}
                        />
                      </td>
                    );
                  })}

                  {/* Row total */}
                  <td className="px-2 py-1.5 border-r border-gray-200 text-center font-semibold text-gray-700 text-xs">
                    {rowTotal > 0 ? `${rowTotal.toFixed(1)}h` : '—'}
                  </td>

                  {/* Delete */}
                  <td className="px-1 py-1.5 text-center">
                    <button
                      onClick={() => deleteRow(row)}
                      className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Remove row"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Footer totals */}
          <tfoot>
            <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
              <td colSpan={4} className="sticky left-0 bg-gray-50 px-3 py-2 text-xs text-gray-600 border-r border-gray-200">
                Total
              </td>
              {days.map(day => {
                const dk = format(day, 'yyyy-MM-dd');
                const total = dayTotals[dk] || 0;
                return (
                  <td key={dk} className={clsx('text-center px-1 py-2 text-xs border-r border-gray-200', isWeekend(day) && 'bg-gray-100', total > 0 && (total >= 8 ? 'text-green-700' : 'text-orange-600'))}>
                    {total > 0 ? `${total.toFixed(1)}h` : '—'}
                  </td>
                );
              })}
              <td className="text-center px-2 py-2 text-xs text-blue-700 border-r border-gray-200">
                {totalHours.toFixed(1)}h
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add row */}
      <button onClick={addRow} className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium px-1">
        <PlusIcon className="h-4 w-4" /> Add Row
      </button>

      <p className="text-xs text-gray-400">Enter time as HH:MM (e.g. 08:00) or decimal (e.g. 8). Changes save automatically on exit.</p>
    </div>
  );
}
