import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get(`/projects/${id}`).then(r => r.data),
  });

  const { data: utilization } = useQuery({
    queryKey: ['project', id, 'utilization'],
    queryFn: () => api.get(`/projects/${id}/utilization`).then(r => r.data),
  });

  if (isLoading) return <div className="flex justify-center py-16"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (!project) return <div className="card text-center py-12 text-gray-400">Project not found</div>;

  return (
    <div className="space-y-6">
      <Link to="/projects" className="flex items-center gap-2 text-gray-500 hover:text-gray-700 text-sm">
        <ArrowLeftIcon className="h-4 w-4" /> Back to Projects
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
          <p className="text-gray-500">{project.code}{project.client?.name && ` · ${project.client.name}`}</p>
        </div>
        <div className="flex gap-2">
          <span className={project.billable ? 'badge-green' : 'badge-gray'}>{project.billable ? 'Billable' : 'Internal'}</span>
          <span className={project.status === 'ACTIVE' ? 'badge-green' : 'badge-yellow'}>{project.status}</span>
        </div>
      </div>

      {/* Utilization */}
      {utilization && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card text-center">
            <p className="text-2xl font-bold text-gray-900">{(utilization.totalHours || 0).toFixed(1)}h</p>
            <p className="text-xs text-gray-500 mt-1">Hours Used</p>
          </div>
          <div className="card text-center">
            <p className="text-2xl font-bold text-gray-900">{project.budgetHours || '—'}{project.budgetHours ? 'h' : ''}</p>
            <p className="text-xs text-gray-500 mt-1">Budget Hours</p>
          </div>
          <div className="card text-center">
            <p className={`text-2xl font-bold ${(utilization.utilization || 0) > 90 ? 'text-red-600' : 'text-green-600'}`}>
              {utilization.utilization != null ? `${utilization.utilization.toFixed(0)}%` : '—'}
            </p>
            <p className="text-xs text-gray-500 mt-1">Budget Used</p>
          </div>
        </div>
      )}

      {/* Members */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">Team Members ({project.members?.length || 0})</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {(project.members || []).map((m: Record<string, unknown>) => (
            <div key={m.id as string} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700">
                {((m.user as Record<string, string>)?.firstName)?.[0]}{((m.user as Record<string, string>)?.lastName)?.[0]}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{(m.user as Record<string, string>)?.firstName} {(m.user as Record<string, string>)?.lastName}</p>
                <p className="text-xs text-gray-500">{m.role as string}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tasks */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">Tasks ({project.tasks?.length || 0})</h3>
        <div className="space-y-2">
          {(project.tasks || []).map((task: Record<string, unknown>) => (
            <div key={task.id as string} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <p className="text-sm font-medium text-gray-900">{task.name as string}</p>
                {!!task.description && <p className="text-xs text-gray-500">{task.description as string}</p>}
              </div>
              <div className="flex items-center gap-2">
                {!!task.estimatedHours && <span className="text-xs text-gray-400">{task.estimatedHours as number}h est.</span>}
                <span className={task.isBillable ? 'badge-green' : 'badge-gray'}>{task.isBillable ? 'Billable' : 'Internal'}</span>
              </div>
            </div>
          ))}
          {!project.tasks?.length && <p className="text-gray-400 text-sm">No tasks defined</p>}
        </div>
      </div>
    </div>
  );
}
