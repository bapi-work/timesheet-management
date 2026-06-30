import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, startOfWeek, endOfWeek } from 'date-fns';
import { ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import { hasRole, MANAGEMENT_ROLES } from '../lib/roles';
import clsx from 'clsx';

interface CalendarEntry {
  date: string;
  totalHours: number;
  billableHours: number;
  entries: number;
  timesheetId: string;
  status: string;
}

interface LeaveDay {
  startDate: string;
  endDate: string;
  leaveType: string;
  status: string;
  dayType?: string;
}

interface Holiday {
  date: string;
  name: string;
}

export default function CalendarPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const isManager = hasRole(user?.role, MANAGEMENT_ROLES);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selectedDayPopup, setSelectedDayPopup] = useState<{ date: string; users: { name: string; hours: number }[] } | null>(null);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);

  const { data: timesheetData } = useQuery({
    queryKey: ['calendar-timesheets', format(monthStart, 'yyyy-MM')],
    queryFn: () =>
      api.get('/timesheets', {
        params: {
          from: format(startOfWeek(monthStart, { weekStartsOn: 0 }), 'yyyy-MM-dd'),
          to: format(endOfWeek(monthEnd, { weekStartsOn: 0 }), 'yyyy-MM-dd'),
          limit: 200,
        },
      }).then(r => r.data),
  });

  const { data: leaveData } = useQuery({
    queryKey: ['calendar-leave', format(monthStart, 'yyyy-MM')],
    queryFn: () =>
      api.get('/leave', {
        params: {
          startDate: format(monthStart, 'yyyy-MM-dd'),
          endDate: format(monthEnd, 'yyyy-MM-dd'),
        },
      }).then(r => r.data).catch(() => ({ requests: [] })),
  });

  const { data: holidayData } = useQuery({
    queryKey: ['calendar-holidays', format(monthStart, 'yyyy-MM')],
    queryFn: () =>
      api.get('/leave/holidays', {
        params: {
          year: format(monthStart, 'yyyy'),
        },
      }).then(r => r.data).catch(() => []),
  });

  // Build a map of date → aggregated entry data; also userDayMap for manager day-click
  const entryMap = new Map<string, CalendarEntry>();
  const userDayMap = new Map<string, { name: string; hours: number }[]>();
  const timesheets = timesheetData?.timesheets || timesheetData || [];
  if (Array.isArray(timesheets)) {
    timesheets.forEach((ts: { periodStart: string; periodEnd: string; totalHours: number; billableHours: number; id: string; status: string; entries?: unknown[]; user?: { firstName: string; lastName: string } }) => {
      const entries = ts.entries || [];
      const userName = ts.user ? `${ts.user.firstName} ${ts.user.lastName}` : 'Unknown';
      (entries as Array<{ date: string; hours: number; isBillable: boolean }>).forEach(entry => {
        const key = entry.date.slice(0, 10);
        const existing = entryMap.get(key);
        if (existing) {
          existing.totalHours += entry.hours;
          existing.billableHours += entry.isBillable ? entry.hours : 0;
          existing.entries += 1;
        } else {
          entryMap.set(key, {
            date: key,
            totalHours: entry.hours,
            billableHours: entry.isBillable ? entry.hours : 0,
            entries: 1,
            timesheetId: ts.id,
            status: ts.status,
          });
        }
        // Track per-user hours for manager popup
        if (isManager) {
          const list = userDayMap.get(key) || [];
          const existing2 = list.find(u => u.name === userName);
          if (existing2) { existing2.hours += entry.hours; } else { list.push({ name: userName, hours: entry.hours }); }
          userDayMap.set(key, list);
        }
      });
    });
  }

  // Build leave map
  const leaveMap = new Map<string, LeaveDay>();
  const leaves: LeaveDay[] = leaveData?.requests || leaveData || [];
  if (Array.isArray(leaves)) {
    leaves.forEach(l => {
      if (l.status === 'APPROVED') {
        const days = eachDayOfInterval({ start: new Date(l.startDate), end: new Date(l.endDate) });
        days.forEach(d => leaveMap.set(format(d, 'yyyy-MM-dd'), l));
      }
    });
  }

  // Build holiday map
  const holidayMap = new Map<string, Holiday>();
  const holidays: Holiday[] = Array.isArray(holidayData) ? holidayData : [];
  holidays.forEach(h => holidayMap.set(h.date.slice(0, 10), h));

  // For week view, show only the 7 days of the week containing currentDate
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });

  const calStart = view === 'week' ? weekStart : startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd   = view === 'week' ? weekEnd   : endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const prevMonth = () => setCurrentDate(d =>
    view === 'week'
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7)
      : new Date(d.getFullYear(), d.getMonth() - 1, 1)
  );
  const nextMonth = () => setCurrentDate(d =>
    view === 'week'
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
      : new Date(d.getFullYear(), d.getMonth() + 1, 1)
  );
  const goToday = () => setCurrentDate(new Date());

  const getHoursColor = (hours: number) => {
    if (hours >= 8) return 'bg-green-100 text-green-800';
    if (hours >= 4) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-700';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('calendar.title')}</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setView('month')}
              className={clsx('px-3 py-1.5 text-sm', view === 'month' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50')}
            >
              {t('calendar.month')}
            </button>
            <button
              onClick={() => setView('week')}
              className={clsx('px-3 py-1.5 text-sm border-l', view === 'week' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50')}
            >
              {t('calendar.week')}
            </button>
          </div>
        </div>
      </div>

      {/* Calendar navigation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {view === 'week'
                ? `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`
                : format(currentDate, 'MMMM yyyy')}
            </h2>
            <button onClick={goToday} className="px-3 py-1 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100">
              {t('calendar.today')}
            </button>
          </div>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Day header */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {days.map((day, idx) => {
            const key = format(day, 'yyyy-MM-dd');
            const entry = entryMap.get(key);
            const leave = leaveMap.get(key);
            const holiday = holidayMap.get(key);
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isTodayDay = isToday(day);
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;

            return (
              <div
                key={idx}
                className={clsx(
                  'min-h-[90px] p-2 border-b border-r border-gray-100 relative',
                  !isCurrentMonth && 'bg-gray-50',
                  isWeekend && isCurrentMonth && 'bg-blue-50/30',
                  holiday && 'bg-purple-50',
                )}
              >
                <div className={clsx(
                  'w-7 h-7 flex items-center justify-center text-sm font-medium rounded-full mb-1',
                  isTodayDay ? 'bg-blue-600 text-white' : isCurrentMonth ? 'text-gray-900' : 'text-gray-300',
                )}>
                  {format(day, 'd')}
                </div>

                {holiday && (
                  <div className="text-xs text-purple-700 font-medium truncate mb-1">
                    🎉 {holiday.name}
                  </div>
                )}

                {leave && (
                  <div className={`text-xs rounded px-1 py-0.5 mb-1 truncate ${leave.dayType === 'HALF_DAY' ? 'bg-yellow-100 text-yellow-700' : 'bg-orange-100 text-orange-700'}`}>
                    {leave.dayType === 'HALF_DAY' ? '½' : '🏖'} {leave.leaveType.charAt(0) + leave.leaveType.slice(1).toLowerCase()}
                  </div>
                )}

                {entry && isCurrentMonth && (
                  <div
                    className={clsx('text-xs rounded px-1 py-0.5 font-medium', getHoursColor(entry.totalHours), isManager && userDayMap.has(key) && 'cursor-pointer hover:opacity-80')}
                    onClick={() => {
                      if (isManager && userDayMap.has(key)) {
                        setSelectedDayPopup({ date: key, users: userDayMap.get(key)! });
                      }
                    }}
                  >
                    {entry.totalHours.toFixed(1)} {t('calendar.hoursWorked')}
                    {entry.billableHours > 0 && entry.billableHours < entry.totalHours && (
                      <span className="text-gray-500 ml-1">({entry.billableHours.toFixed(1)}b)</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Day detail popup (manager only) */}
      {selectedDayPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                Hours on {format(new Date(selectedDayPopup.date + 'T00:00:00'), 'MMM d, yyyy')}
              </h3>
              <button onClick={() => setSelectedDayPopup(null)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="divide-y divide-gray-100">
              {selectedDayPopup.users.sort((a, b) => b.hours - a.hours).map((u, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-800">{u.name}</span>
                  <span className={clsx('text-sm font-semibold', getHoursColor(u.hours), 'px-2 py-0.5 rounded')}>
                    {u.hours.toFixed(2)}h
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 text-right">
              Total: {selectedDayPopup.users.reduce((s, u) => s + u.hours, 0).toFixed(2)}h
            </p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 text-sm text-gray-600 px-1">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-green-100 border border-green-300" /> 8+ hrs</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300" /> 4–8 hrs</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-100 border border-red-300" /> &lt;4 hrs</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-300" /> {t('calendar.leaveDay')}</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-purple-100 border border-purple-300" /> {t('calendar.holiday')}</div>
      </div>

      {/* Monthly summary */}
      <div className="grid grid-cols-3 gap-4">
        {(() => {
          const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
          const totalHours = monthDays.reduce((s, d) => s + (entryMap.get(format(d, 'yyyy-MM-dd'))?.totalHours || 0), 0);
          const billableHours = monthDays.reduce((s, d) => s + (entryMap.get(format(d, 'yyyy-MM-dd'))?.billableHours || 0), 0);
          const workdays = monthDays.filter(d => d.getDay() !== 0 && d.getDay() !== 6).length;
          const daysLogged = monthDays.filter(d => (entryMap.get(format(d, 'yyyy-MM-dd'))?.totalHours || 0) > 0).length;

          return (
            <>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Total Hours</p>
                <p className="text-2xl font-bold text-gray-900">{totalHours.toFixed(1)}</p>
                <p className="text-xs text-gray-400">{daysLogged} of {workdays} working days logged</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Billable Hours</p>
                <p className="text-2xl font-bold text-blue-600">{billableHours.toFixed(1)}</p>
                <p className="text-xs text-gray-400">{totalHours > 0 ? ((billableHours / totalHours) * 100).toFixed(0) : 0}% billable</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Leave Days</p>
                <p className="text-2xl font-bold text-orange-600">{leaveMap.size}</p>
                <p className="text-xs text-gray-400">approved this month</p>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
