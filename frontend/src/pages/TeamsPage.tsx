import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { UserGroupIcon, PlusIcon, XMarkIcon, PencilIcon, TrashIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/auth.store';
import { ADMIN_ROLES, MANAGEMENT_ROLES, hasRole } from '../lib/roles';
import toast from 'react-hot-toast';

interface Team {
  id: string;
  name: string;
  description?: string;
  departmentId?: string;
  projectId?: string;
  clientId?: string;
  leadId?: string;
  department?: { id: string; name: string };
  project?: { id: string; name: string };
  client?: { id: string; name: string };
  lead?: { id: string; firstName: string; lastName: string };
  _count?: { members: number };
}

interface TeamMember {
  id: string;
  userId: string;
  user: { id: string; firstName: string; lastName: string; employeeId: string; designation?: string };
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
}

function TeamFormModal({ team, onClose }: { team?: Team; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!team;
  const [name, setName] = useState(team?.name || '');
  const [description, setDescription] = useState(team?.description || '');
  const [departmentId, setDepartmentId] = useState(team?.departmentId || '');
  const [projectId, setProjectId] = useState(team?.projectId || '');
  const [clientId, setClientId] = useState(team?.clientId || '');
  const [leadId, setLeadId] = useState(team?.leadId || '');

  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: () => api.get('/departments').then(r => r.data as { id: string; name: string }[]) });
  const { data: projectsData } = useQuery({ queryKey: ['projects-active'], queryFn: () => api.get('/projects?limit=100').then(r => r.data) });
  const { data: clientsData } = useQuery({ queryKey: ['clients-active'], queryFn: () => api.get('/clients?limit=100').then(r => r.data) });
  const { data: usersData } = useQuery({ queryKey: ['users-all'], queryFn: () => api.get('/users?limit=200').then(r => r.data) });

  const projects: { id: string; name: string }[] = projectsData?.projects || [];
  const clients: { id: string; name: string }[] = clientsData?.clients || [];
  const employees: Employee[] = usersData?.users || [];

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        description: description || undefined,
        departmentId: departmentId || undefined,
        projectId: projectId || undefined,
        clientId: clientId || undefined,
        leadId: leadId || undefined,
      };
      return isEdit ? api.put(`/teams/${team!.id}`, payload) : api.post('/teams', payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Team updated' : 'Team created');
      qc.invalidateQueries({ queryKey: ['teams'] });
      onClose();
    },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Failed to save team'),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-900">{isEdit ? 'Edit Team' : 'New Team'}</h3>
          <button onClick={onClose}><XMarkIcon className="h-5 w-5 text-gray-400" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="label">Team Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Frontend Squad" />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="input" placeholder="Optional description..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Department (optional)</label>
              <select value={departmentId} onChange={e => setDepartmentId(e.target.value)} className="input">
                <option value="">None</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Project (optional)</label>
              <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input">
                <option value="">None</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Client (optional)</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)} className="input">
                <option value="">None</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Team Lead (optional)</label>
              <select value={leadId} onChange={e => setLeadId(e.target.value)} className="input">
                <option value="">No Lead</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!name || mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create Team')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddTeamMemberModal({ teamId, existingMemberIds, onClose }: { teamId: string; existingMemberIds: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');

  const { data: usersData } = useQuery({ queryKey: ['users-all'], queryFn: () => api.get('/users?limit=200').then(r => r.data) });
  const employees: Employee[] = (usersData?.users || []).filter((u: Employee) => !existingMemberIds.includes(u.id));

  const mutation = useMutation({
    mutationFn: () => api.post(`/teams/${teamId}/members`, { userId }),
    onSuccess: () => {
      toast.success('Member added');
      qc.invalidateQueries({ queryKey: ['team', teamId] });
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
        <div className="p-4">
          <label className="label">Employee *</label>
          <select value={userId} onChange={e => setUserId(e.target.value)} className="input">
            <option value="">Select employee...</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeId})</option>
            ))}
          </select>
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

function TeamCard({ team, canManage, canDelete }: { team: Team; canManage: boolean; canDelete: boolean }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editTeam, setEditTeam] = useState(false);
  const [addMember, setAddMember] = useState(false);

  const { data: teamDetail } = useQuery({
    queryKey: ['team', team.id],
    queryFn: () => api.get(`/teams/${team.id}`).then(r => r.data),
    enabled: expanded,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/teams/${team.id}`),
    onSuccess: () => {
      toast.success('Team deleted');
      qc.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: () => toast.error('Failed to delete team'),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/teams/${team.id}/members/${userId}`),
    onSuccess: () => {
      toast.success('Member removed');
      qc.invalidateQueries({ queryKey: ['team', team.id] });
    },
  });

  const memberIds = (teamDetail?.members || []).map((m: TeamMember) => m.userId);

  const context = [
    team.department && `Dept: ${team.department.name}`,
    team.project && `Project: ${team.project.name}`,
    team.client && `Client: ${team.client.name}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900">{team.name}</h3>
            <span className="badge-gray text-xs">{team._count?.members || 0} members</span>
          </div>
          {context && <p className="text-xs text-gray-500 mt-0.5">{context}</p>}
          {team.description && <p className="text-sm text-gray-600 mt-1">{team.description}</p>}
          {team.lead && <p className="text-xs text-gray-500 mt-1">Lead: {team.lead.firstName} {team.lead.lastName}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-primary-600 hover:underline px-2 py-1">
            {expanded ? 'Hide' : 'Members'}
          </button>
          {canManage && (
            <button onClick={() => setEditTeam(true)} className="p-1.5 rounded text-gray-400 hover:bg-gray-100 hover:text-primary-600">
              <PencilIcon className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => { if (confirm(`Delete team "${team.name}"?`)) deleteMutation.mutate(); }}
              className="p-1.5 rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-700">Members</p>
            {canManage && (
              <button onClick={() => setAddMember(true)} className="btn-sm btn-secondary flex items-center gap-1">
                <UserPlusIcon className="h-3.5 w-3.5" /> Add
              </button>
            )}
          </div>
          {!teamDetail?.members?.length ? (
            <p className="text-sm text-gray-400">No members yet</p>
          ) : (
            <div className="space-y-2">
              {teamDetail.members.map((m: TeamMember) => (
                <div key={m.id} className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700">
                    {m.user.firstName[0]}{m.user.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{m.user.firstName} {m.user.lastName}</p>
                    {m.user.designation && <p className="text-xs text-gray-400">{m.user.designation}</p>}
                  </div>
                  {canManage && (
                    <button onClick={() => removeMember.mutate(m.userId)} className="p-1 text-gray-300 hover:text-red-500">
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editTeam && <TeamFormModal team={team} onClose={() => setEditTeam(false)} />}
      {addMember && <AddTeamMemberModal teamId={team.id} existingMemberIds={memberIds} onClose={() => setAddMember(false)} />}
    </div>
  );
}

export default function TeamsPage() {
  const user = useAuthStore(s => s.user);
  const canManage = hasRole(user?.role, MANAGEMENT_ROLES);
  const canDelete = hasRole(user?.role, MANAGEMENT_ROLES);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState('');

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ['teams', filter],
    queryFn: () => api.get('/teams', { params: filter ? { search: filter } : {} }).then(r => r.data as Team[]),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Teams</h1>
          <p className="text-sm text-gray-500">{teams.length} teams</p>
        </div>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <PlusIcon className="h-4 w-4" /> New Team
          </button>
        )}
      </div>

      <input
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="input max-w-xs"
        placeholder="Search teams..."
      />

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : teams.length === 0 ? (
        <div className="card text-center py-16">
          <UserGroupIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No teams yet</p>
          {canManage && (
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
              <PlusIcon className="h-4 w-4" /> Create First Team
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {teams.map((team: Team) => (
            <TeamCard key={team.id} team={team} canManage={canManage} canDelete={canDelete} />
          ))}
        </div>
      )}

      {showCreate && <TeamFormModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
