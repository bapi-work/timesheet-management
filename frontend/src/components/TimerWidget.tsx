import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PlayIcon, StopIcon, TrashIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/solid';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import api from '../lib/api';

interface TimerEntry {
  id: string;
  startTime: string;
  description?: string;
  project?: { id: string; name: string };
  task?: { id: string; name: string };
}

interface Project {
  id: string;
  name: string;
}

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function TimerWidget() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');

  const { data: activeTimer, isLoading } = useQuery<TimerEntry | null>({
    queryKey: ['timer-active'],
    queryFn: () => api.get('/timer/active').then(r => r.data),
    refetchInterval: 30_000,
  });

  const { data: projects } = useQuery({
    queryKey: ['timer-projects'],
    queryFn: () => api.get('/projects', { params: { limit: 50, status: 'ACTIVE' } }).then(r => r.data),
    enabled: expanded,
  });

  // Tick the elapsed counter every second when timer is running
  useEffect(() => {
    if (!activeTimer) { setElapsed(0); return; }
    const start = new Date(activeTimer.startTime).getTime();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeTimer]);

  const startMutation = useMutation({
    mutationFn: () => api.post('/timer/start', {
      projectId: projectId || undefined,
      description: description || undefined,
    }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer-active'] });
      toast.success(t('timer.timerStarted'));
      setDescription('');
      setProjectId('');
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to start timer'),
  });

  const stopMutation = useMutation({
    mutationFn: (entryId: string) => api.post(`/timer/stop/${entryId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer-active'] });
      qc.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success(t('timer.timerStopped'));
    },
    onError: () => toast.error('Failed to stop timer'),
  });

  const discardMutation = useMutation({
    mutationFn: (entryId: string) => api.delete(`/timer/${entryId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timer-active'] });
      toast.success(t('timer.timerDiscarded'));
    },
    onError: () => toast.error('Failed to discard timer'),
  });

  const projectList: Project[] = projects?.projects || projects || [];
  const isRunning = !!activeTimer;

  return (
    <div className={clsx(
      'fixed bottom-4 right-4 z-40 rounded-2xl shadow-2xl border transition-all duration-200',
      isRunning ? 'border-green-300 bg-white' : 'border-gray-200 bg-white',
      expanded ? 'w-80' : 'w-auto',
    )}>
      {/* Header / compact view */}
      <div className="flex items-center gap-3 px-4 py-3">
        {isRunning ? (
          <>
            {/* Pulsing dot */}
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500 font-medium">{t('timer.running')}</p>
              <p className="text-lg font-mono font-bold text-gray-900 leading-none">{formatElapsed(elapsed)}</p>
              {activeTimer?.project && (
                <p className="text-xs text-gray-500 truncate">{activeTimer.project.name}</p>
              )}
            </div>
            <button
              onClick={() => stopMutation.mutate(activeTimer.id)}
              disabled={stopMutation.isPending}
              className="p-2 rounded-xl bg-red-500 hover:bg-red-600 text-white transition-colors"
              title={t('timer.stopTimer')}
            >
              <StopIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => discardMutation.mutate(activeTimer.id)}
              disabled={discardMutation.isPending}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title={t('timer.discardTimer')}
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
              {t('timer.noActiveTimer')}
            </button>
            <button
              onClick={() => setExpanded(v => !v)}
              className="p-1.5 ml-2 text-gray-400 hover:text-gray-600"
            >
              {expanded ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronUpIcon className="h-4 w-4" />}
            </button>
          </>
        )}
        {isRunning && (
          <button onClick={() => setExpanded(v => !v)} className="p-1.5 text-gray-400 hover:text-gray-600">
            {expanded ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronUpIcon className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Expanded — start form */}
      {expanded && !isRunning && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-3">
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('timer.addDescription')}
            className="input-field w-full text-sm"
            onKeyDown={e => { if (e.key === 'Enter') startMutation.mutate(); }}
          />
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="input-field w-full text-sm"
          >
            <option value="">{t('timer.selectProject')}</option>
            {projectList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <PlayIcon className="h-4 w-4" />
            {startMutation.isPending ? 'Starting...' : t('timer.startTimer')}
          </button>
        </div>
      )}

      {/* Expanded — running detail */}
      {expanded && isRunning && activeTimer && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-2 text-sm">
          {activeTimer.description && (
            <p className="text-gray-700"><span className="text-gray-400">Task:</span> {activeTimer.description}</p>
          )}
          {activeTimer.task && (
            <p className="text-gray-700"><span className="text-gray-400">Sub-task:</span> {activeTimer.task.name}</p>
          )}
          <p className="text-gray-500 text-xs">
            Started: {new Date(activeTimer.startTime).toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  );
}
