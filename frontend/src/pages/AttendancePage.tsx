import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ClockIcon, ArrowRightStartOnRectangleIcon, ArrowLeftEndOnRectangleIcon } from '@heroicons/react/24/outline';

export default function AttendancePage() {
  const qc = useQueryClient();

  const { data: today } = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: () => api.get('/attendance/today').then(r => r.data),
    refetchInterval: 60_000,
  });

  const { data: history = [] } = useQuery({
    queryKey: ['attendance', 'my'],
    queryFn: () => api.get('/attendance/my').then(r => r.data),
  });

  const clockIn = useMutation({
    mutationFn: () => api.post('/attendance/clock-in'),
    onSuccess: () => { toast.success('Clocked in!'); qc.invalidateQueries({ queryKey: ['attendance'] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const clockOut = useMutation({
    mutationFn: () => api.post('/attendance/clock-out'),
    onSuccess: () => { toast.success('Clocked out!'); qc.invalidateQueries({ queryKey: ['attendance'] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const isClockedIn = !!today?.checkIn;
  const isClockedOut = !!today?.checkOut;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>

      {/* Today's Status */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="font-semibold text-gray-900">Today — {format(new Date(), 'EEEE, MMMM d, yyyy')}</h2>
            <div className="flex items-center gap-6 mt-3">
              <div>
                <p className="text-xs text-gray-500">Clock In</p>
                <p className="text-lg font-bold text-gray-900">
                  {today?.checkIn ? format(new Date(today.checkIn), 'hh:mm a') : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Clock Out</p>
                <p className="text-lg font-bold text-gray-900">
                  {today?.checkOut ? format(new Date(today.checkOut), 'hh:mm a') : '—'}
                </p>
              </div>
              {today?.workHours != null && (
                <div>
                  <p className="text-xs text-gray-500">Hours</p>
                  <p className="text-lg font-bold text-green-600">{today.workHours.toFixed(2)}h</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            {!isClockedIn && (
              <button onClick={() => clockIn.mutate()} disabled={clockIn.isPending} className="btn-success btn-lg">
                <ArrowRightStartOnRectangleIcon className="h-5 w-5" /> Clock In
              </button>
            )}
            {isClockedIn && !isClockedOut && (
              <button onClick={() => clockOut.mutate()} disabled={clockOut.isPending} className="btn-danger btn-lg">
                <ArrowLeftEndOnRectangleIcon className="h-5 w-5" /> Clock Out
              </button>
            )}
            {isClockedIn && isClockedOut && (
              <div className="flex items-center gap-2 text-green-600">
                <ClockIcon className="h-5 w-5" />
                <span className="font-medium">Day complete</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Attendance History</h3>
        </div>
        <div className="table-wrapper border-0">
          <table className="table">
            <thead>
              <tr>
                <th className="th">Date</th>
                <th className="th">Clock In</th>
                <th className="th">Clock Out</th>
                <th className="th">Work Hours</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.slice(0, 30).map((r: Record<string, unknown>) => (
                <tr key={r.id as string} className="tr-hover">
                  <td className="td">{format(new Date(r.date as string), 'EEE, MMM d, yyyy')}</td>
                  <td className="td">{r.checkIn ? format(new Date(r.checkIn as string), 'hh:mm a') : '—'}</td>
                  <td className="td">{r.checkOut ? format(new Date(r.checkOut as string), 'hh:mm a') : '—'}</td>
                  <td className="td">
                    {r.workHours != null ? (
                      <span className={(r.workHours as number) >= 8 ? 'text-green-600 font-medium' : 'text-orange-600 font-medium'}>
                        {(r.workHours as number).toFixed(2)}h
                      </span>
                    ) : '—'}
                  </td>
                  <td className="td">
                    <span className={r.status === 'PRESENT' ? 'badge-green' : r.status === 'ON_LEAVE' ? 'badge-blue' : r.status === 'HOLIDAY' ? 'badge-purple' : 'badge-red'}>
                      {(r.status as string).replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={5} className="td text-center text-gray-400 py-10">No attendance records</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
