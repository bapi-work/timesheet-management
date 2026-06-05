import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { Bar, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function AnalyticsPage() {
  const { data: trends } = useQuery({
    queryKey: ['analytics', 'trends', 12],
    queryFn: () => api.get('/analytics/trends?months=12').then(r => r.data),
  });

  const { data: utilization = [] } = useQuery({
    queryKey: ['report', 'utilization', 'analytics'],
    queryFn: () => api.get('/reports/utilization').then(r => r.data),
  });

  const { data: projectEffort = [] } = useQuery({
    queryKey: ['report', 'project-effort', 'analytics'],
    queryFn: () => api.get('/reports/project-effort').then(r => r.data),
  });

  const top10Users = [...utilization]
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.totalHours as number) - (a.totalHours as number))
    .slice(0, 10);

  const top5Projects = [...projectEffort]
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.totalHours as number) - (a.totalHours as number))
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Monthly Trend */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-4">Monthly Hours (12 months)</h3>
          {trends && (
            <Bar
              data={{
                labels: trends.map((t: { month: string }) => t.month),
                datasets: [{
                  label: 'Hours',
                  data: trends.map((t: { hours: number }) => t.hours),
                  backgroundColor: 'rgba(37,99,235,0.7)',
                  borderRadius: 6,
                }],
              }}
              options={{ responsive: true, plugins: { legend: { display: false } } }}
            />
          )}
        </div>

        {/* Top Projects */}
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-4">Top 5 Projects by Hours</h3>
          {top5Projects.length > 0 && (
            <Doughnut
              data={{
                labels: top5Projects.map((p: Record<string, unknown>) => p.name as string),
                datasets: [{
                  data: top5Projects.map((p: Record<string, unknown>) => p.totalHours as number),
                  backgroundColor: ['#2563eb','#7c3aed','#059669','#d97706','#dc2626'],
                }],
              }}
              options={{ responsive: true }}
            />
          )}
        </div>
      </div>

      {/* Top Employees */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">Top 10 Contributors</h3>
        <div className="space-y-3">
          {top10Users.map((u: Record<string, unknown>, i: number) => (
            <div key={u.id as string} className="flex items-center gap-3">
              <span className="text-sm font-bold text-gray-400 w-5 text-right">{i + 1}</span>
              <div className="h-7 w-7 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700">
                {(u.firstName as string)?.[0]}{(u.lastName as string)?.[0]}
              </div>
              <span className="text-sm font-medium flex-1">{u.firstName as string} {u.lastName as string}</span>
              <div className="flex items-center gap-3 w-48">
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-primary-500 rounded-full" style={{ width: `${Math.min(((u.totalHours as number) / (top10Users[0]?.totalHours as number || 1)) * 100, 100)}%` }} />
                </div>
                <span className="text-sm font-semibold text-gray-700 w-16 text-right">{(u.totalHours as number).toFixed(0)}h</span>
              </div>
              <span className="text-xs text-gray-500 w-16 text-right">{u.utilizationPct as number}% bill</span>
            </div>
          ))}
          {top10Users.length === 0 && <p className="text-gray-400 text-sm">No data available</p>}
        </div>
      </div>
    </div>
  );
}
