import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { PlusIcon, PencilIcon, TrashIcon, BuildingOffice2Icon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/auth.store';
import { ADMIN_ROLES, hasRole } from '../lib/roles';

interface Department {
  id: string;
  name: string;
  code?: string;
  description?: string;
  costCenter?: string;
  managerId?: string;
  manager?: { id: string; firstName: string; lastName: string };
  _count?: { users: number; teams: number };
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
}

function DepartmentFormModal({
  dept,
  users,
  onClose,
}: {
  dept?: Department;
  users: User[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: dept?.name || '',
    code: dept?.code || '',
    description: dept?.description || '',
    costCenter: dept?.costCenter || '',
    managerId: dept?.managerId || '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      dept
        ? api.put(`/departments/${dept.id}`, form)
        : api.post('/departments', form),
    onSuccess: () => {
      toast.success(dept ? 'Department updated' : 'Department created');
      qc.invalidateQueries({ queryKey: ['departments'] });
      onClose();
    },
    onError: (e: unknown) => {
      toast.error(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to save department'
      );
    },
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b font-semibold text-gray-900">
          {dept ? 'Edit Department' : 'New Department'}
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="label">Department Name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Engineering" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Code</label>
              <input className="input" value={form.code} onChange={e => set('code', e.target.value)} placeholder="ENG" />
            </div>
            <div>
              <label className="label">Cost Center</label>
              <input className="input" value={form.costCenter} onChange={e => set('costCenter', e.target.value)} placeholder="CC-001" />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div>
            <label className="label">Department Manager</label>
            <select className="input" value={form.managerId} onChange={e => set('managerId', e.target.value)}>
              <option value="">— None —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.employeeId})</option>
              ))}
            </select>
          </div>
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!form.name.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving...' : dept ? 'Save Changes' : 'Create Department'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DepartmentsPage() {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const isAdmin = hasRole(user?.role, ADMIN_ROLES);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [search, setSearch] = useState('');

  const { data: departments = [], isLoading } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then(r => r.data),
  });

  const { data: usersData } = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => api.get('/users?limit=500').then(r => r.data),
    enabled: isAdmin,
  });
  const users: User[] = usersData?.users || [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}`),
    onSuccess: () => {
      toast.success('Department deleted');
      qc.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (e: unknown) => {
      toast.error(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to delete department'
      );
    },
  });

  const filtered = departments.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    (d.code || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Departments</h1>
          <p className="text-sm text-gray-500 mt-0.5">{departments.length} department{departments.length !== 1 ? 's' : ''}</p>
        </div>
        {isAdmin && (
          <button className="btn-primary flex items-center gap-2" onClick={() => { setEditing(null); setShowModal(true); }}>
            <PlusIcon className="h-4 w-4" /> New Department
          </button>
        )}
      </div>

      <input
        className="input max-w-xs"
        placeholder="Search departments..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          <BuildingOffice2Icon className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No departments found</p>
          {isAdmin && <button className="btn-primary mt-4" onClick={() => { setEditing(null); setShowModal(true); }}>Create First Department</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(dept => (
            <div key={dept.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <BuildingOffice2Icon className="h-5 w-5 text-primary-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{dept.name}</h3>
                    {dept.code && <p className="text-xs text-gray-400">{dept.code}{dept.costCenter ? ` · ${dept.costCenter}` : ''}</p>}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => { setEditing(dept); setShowModal(true); }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                      title="Edit"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete department "${dept.name}"? This cannot be undone.`)) {
                          deleteMutation.mutate(dept.id);
                        }
                      }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                      title="Delete"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {dept.description && (
                <p className="text-sm text-gray-500 mt-3 line-clamp-2">{dept.description}</p>
              )}

              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100 text-sm text-gray-600">
                <span>{dept._count?.users ?? 0} employee{dept._count?.users !== 1 ? 's' : ''}</span>
                <span>{dept._count?.teams ?? 0} team{dept._count?.teams !== 1 ? 's' : ''}</span>
                {dept.manager && (
                  <span className="ml-auto text-gray-500 truncate">
                    Manager: {dept.manager.firstName} {dept.manager.lastName}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <DepartmentFormModal
          dept={editing ?? undefined}
          users={users}
          onClose={() => { setShowModal(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
