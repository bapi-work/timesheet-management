import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { ArrowLeftIcon, UserPlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import { useAuthStore } from '../store/auth.store';
import { MANAGEMENT_ROLES, hasRole } from '../lib/roles';
import toast from 'react-hot-toast';

interface ProjectMember {
  id: string;
  userId: string;
  role?: string;
  user: { id: string; firstName: string; lastName: string; avatarUrl?: string };
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
}

function AddMemberModal({ projectId, existingMemberIds, onClose }: { projectId: string; existingMemberIds: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('MEMBER');

  const { data: usersData } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => api.get('/users?limit=200').then(r => r.data),
  });
  const employees: Employee[] = (usersData?.users || []).filter((u: Employee) => !existingMemberIds.includes(u.id));

  const mutation = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/members`, { userId, role }),
    onSuccess: () => {
      toast.success('Member added');
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      onClose();
    },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Failed to add member'),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-900">Add Team Member</h3>
          <button onClick={onClose}><XMarkIcon className="h-5 w-5 text-gray-400" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="label">Employee *</label>
            <select value={userId} onChange={e => setUserId(e.target.value)} className="input">
              <option value="">Select employee...</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeId})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="input">
              <option value="MEMBER">Member</option>
              <option value="LEAD">Lead</option>
              <option value="DEVELOPER">Developer</option>
              <option value="DESIGNER">Designer</option>
              <option value="QA">QA</option>
              <option value="PM">Project Manager</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!userId || mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Adding...' : 'Add Member'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore(s => s.user);
  const isManager = hasRole(user?.role, MANAGEMENT_ROLES);
  const [showAddMember, setShowAddMember] = useState(false);
  const qc = useQueryClient();

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get(`/projects/${id}`).then(r => r.data),
  });

  const { data: utilization } = useQuery({
    queryKey: ['project', id, 'utilization'],
    queryFn: () => api.get(`/projects/${id}/utilization`).then(r => r.data),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/projects/${id}/members/${userId}`),
    onSuccess: () => {
      toast.success('Member removed');
      qc.invalidateQueries({ queryKey: ['project', id] });
    },
    onError: () => toast.error('Failed to remove member'),
  });

  if (isLoading) return <div className="flex justify-center py-16"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (!project) return <div className="card text-center py-12 text-gray-400">Project not found</div>;

  const memberIds: string[] = (project.members || []).map((m: ProjectMember) => m.userId);

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

      {project.description && (
        <p className="text-sm text-gray-600 card">{project.description}</p>
      )}

      {/* Dates */}
      {(project.startDate || project.endDate) && (
        <div className="flex gap-6 text-sm text-gray-600">
          {project.startDate && <span>Start: <strong>{format(new Date(project.startDate), 'MMM d, yyyy')}</strong></span>}
          {project.endDate && <span>End: <strong>{format(new Date(project.endDate), 'MMM d, yyyy')}</strong></span>}
        </div>
      )}

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
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Team Members ({project.members?.length || 0})</h3>
          {isManager && (
            <button onClick={() => setShowAddMember(true)} className="btn-primary btn-sm flex items-center gap-1.5">
              <UserPlusIcon className="h-4 w-4" /> Add Member
            </button>
          )}
        </div>
        {!project.members?.length ? (
          <p className="text-gray-400 text-sm">No members assigned</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {project.members.map((m: ProjectMember) => (
              <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700 flex-shrink-0">
                  {m.user.firstName?.[0]}{m.user.lastName?.[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{m.user.firstName} {m.user.lastName}</p>
                  <p className="text-xs text-gray-500">{m.role}</p>
                </div>
                {isManager && (
                  <button
                    onClick={() => removeMember.mutate(m.userId)}
                    className="p-1 rounded text-gray-300 hover:text-red-500 flex-shrink-0"
                    title="Remove"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
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

      {showAddMember && (
        <AddMemberModal
          projectId={id!}
          existingMemberIds={memberIds}
          onClose={() => setShowAddMember(false)}
        />
      )}
    </div>
  );
}
