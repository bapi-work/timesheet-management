import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import api from '../lib/api';
import { ArrowLeftIcon, UserPlusIcon, XMarkIcon, PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
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

interface Task {
  id: string;
  name: string;
  description?: string;
  estimatedHours?: number;
  isBillable: boolean;
  isActive: boolean;
}

interface TaskFormData {
  name: string;
  description: string;
  estimatedHours: string;
  isBillable: boolean;
}

function TaskFormModal({ projectId, task, onClose }: { projectId: string; task?: Task; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<TaskFormData>({
    defaultValues: {
      name: task?.name || '',
      description: task?.description || '',
      estimatedHours: task?.estimatedHours ? String(task.estimatedHours) : '',
      isBillable: task?.isBillable ?? true,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: TaskFormData) => {
      const payload = {
        name: data.name,
        description: data.description || undefined,
        estimatedHours: data.estimatedHours ? Number(data.estimatedHours) : undefined,
        isBillable: data.isBillable,
      };
      return task
        ? api.put(`/projects/${projectId}/tasks/${task.id}`, payload)
        : api.post(`/projects/${projectId}/tasks`, payload);
    },
    onSuccess: () => {
      toast.success(task ? 'Task updated' : 'Task created');
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      onClose();
    },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Failed'),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-900">{task ? 'Edit Task' : 'New Task'}</h3>
          <button onClick={onClose}><XMarkIcon className="h-5 w-5 text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-4 space-y-3">
          <div>
            <label className="label">Task Name *</label>
            <input {...register('name', { required: true })} className={`input ${errors.name ? 'input-error' : ''}`} placeholder="e.g. Frontend development" />
          </div>
          <div>
            <label className="label">Description</label>
            <input {...register('description')} className="input" placeholder="Optional description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Estimated Hours</label>
              <input {...register('estimatedHours')} type="number" step="0.5" className="input" placeholder="e.g. 40" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input {...register('isBillable')} type="checkbox" id="isBillable" className="rounded" />
              <label htmlFor="isBillable" className="text-sm cursor-pointer">Billable</label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? 'Saving...' : task ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore(s => s.user);
  const isManager = hasRole(user?.role, MANAGEMENT_ROLES);
  const [showAddMember, setShowAddMember] = useState(false);
  const [taskModal, setTaskModal] = useState<{ open: boolean; task?: Task }>({ open: false });
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

  const deleteTask = useMutation({
    mutationFn: (taskId: string) => api.delete(`/projects/${id}/tasks/${taskId}`),
    onSuccess: (data) => {
      toast.success(data.data?.message || 'Task deleted');
      qc.invalidateQueries({ queryKey: ['project', id] });
    },
    onError: () => toast.error('Failed to delete task'),
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
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Tasks ({project.tasks?.length || 0})</h3>
          {isManager && (
            <button onClick={() => setTaskModal({ open: true })} className="btn-primary btn-sm flex items-center gap-1.5">
              <PlusIcon className="h-4 w-4" /> Add Task
            </button>
          )}
        </div>
        <div className="space-y-1">
          {(project.tasks || []).map((task: Task) => (
            <div key={task.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-gray-50 group">
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${task.isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{task.name}</p>
                {task.description && <p className="text-xs text-gray-500 truncate">{task.description}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                {task.estimatedHours && <span className="text-xs text-gray-400">{task.estimatedHours}h</span>}
                <span className={task.isBillable ? 'badge-green' : 'badge-gray'}>{task.isBillable ? 'Billable' : 'Internal'}</span>
                {isManager && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setTaskModal({ open: true, task })} className="p-1 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50">
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => { if (confirm(`Delete task "${task.name}"?`)) deleteTask.mutate(task.id); }}
                      className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {!project.tasks?.length && <p className="text-gray-400 text-sm py-2">No tasks defined</p>}
        </div>
      </div>

      {showAddMember && (
        <AddMemberModal
          projectId={id!}
          existingMemberIds={memberIds}
          onClose={() => setShowAddMember(false)}
        />
      )}

      {taskModal.open && (
        <TaskFormModal
          projectId={id!}
          task={taskModal.task}
          onClose={() => setTaskModal({ open: false })}
        />
      )}
    </div>
  );
}
