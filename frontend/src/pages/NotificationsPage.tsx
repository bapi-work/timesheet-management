import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { BellIcon, CheckIcon } from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

const NOTIF_ICON: Record<string, string> = {
  TIMESHEET_REMINDER: '⏰',
  APPROVAL_REQUIRED: '📋',
  TIMESHEET_APPROVED: '✅',
  TIMESHEET_REJECTED: '❌',
  ESCALATION: '🔺',
  LEAVE_UPDATE: '📅',
  SYSTEM: '🔔',
};

export default function NotificationsPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications?limit=50').then(r => r.data),
  });

  const readMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const readAllMutation = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => { toast.success('All marked as read'); qc.invalidateQueries({ queryKey: ['notifications'] }); },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          {data?.unreadCount > 0 && <p className="text-sm text-gray-500">{data.unreadCount} unread</p>}
        </div>
        {data?.unreadCount > 0 && (
          <button onClick={() => readAllMutation.mutate()} className="btn-secondary btn-sm">
            <CheckIcon className="h-4 w-4" /> Mark all read
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : (data?.notifications || []).length === 0 ? (
        <div className="card text-center py-16">
          <BellIcon className="h-12 w-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400">No notifications</p>
        </div>
      ) : (
        <div className="space-y-1">
          {(data?.notifications || []).map((n: Record<string, unknown>) => (
            <div key={n.id as string}
              className={clsx('flex items-start gap-4 p-4 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors', !n.isRead && 'bg-blue-50 hover:bg-blue-100/70')}
              onClick={() => !n.isRead && readMutation.mutate(n.id as string)}
            >
              <span className="text-2xl flex-shrink-0">{NOTIF_ICON[n.type as string] || '🔔'}</span>
              <div className="flex-1 min-w-0">
                <p className={clsx('text-sm font-medium text-gray-900', !n.isRead && 'font-semibold')}>{n.title as string}</p>
                <p className="text-sm text-gray-600 mt-0.5">{n.message as string}</p>
                <p className="text-xs text-gray-400 mt-1">{formatDistanceToNow(new Date(n.createdAt as string), { addSuffix: true })}</p>
              </div>
              {!n.isRead && <div className="h-2 w-2 rounded-full bg-primary-500 mt-1 flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
