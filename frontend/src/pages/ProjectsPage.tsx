import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { PlusIcon, FolderIcon, XMarkIcon, MagnifyingGlassIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/auth.store';
import { MANAGEMENT_ROLES, hasRole } from '../lib/roles';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'badge-green', ON_HOLD: 'badge-yellow', COMPLETED: 'badge-blue',
  CANCELLED: 'badge-red', ARCHIVED: 'badge-gray',
};

interface ProjectFormData {
  name: string;
  code: string;
  clientId: string;
  description: string;
  budgetHours: number;
  billable: string;
  status: string;
  startDate: string;
  endDate: string;
}

export default function ProjectsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const isManager = hasRole(user?.role, MANAGEMENT_ROLES);

  const { data, isLoading } = useQuery({
    queryKey: ['projects', search],
    queryFn: () => api.get('/projects', { params: { limit: 50, search: search || undefined } }).then(r => r.data),
  });

  const { data: clientsData } = useQuery({
    queryKey: ['clients-active'],
    queryFn: () => api.get('/clients', { params: { isActive: true, limit: 200 } }).then(r => r.data),
    enabled: showModal,
  });
  const clients: { id: string; name: string }[] = clientsData?.clients || [];

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProjectFormData>();

  const createMutation = useMutation({
    mutationFn: (d: ProjectFormData) => api.post('/projects', {
      ...d,
      billable: d.billable === 'true',
      budgetHours: d.budgetHours || undefined,
    }),
    onSuccess: () => {
      toast.success('Project created!');
      qc.invalidateQueries({ queryKey: ['projects'] });
      setShowModal(false);
      reset();
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message || 'Failed to create project'),
  });

  const projects: Record<string, unknown>[] = data?.projects || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-500 text-sm">{data?.total || 0} projects</p>
        </div>
        {isManager && (
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <PlusIcon className="h-4 w-4" /> New Project
          </button>
        )}
      </div>

      <div className="relative max-w-xs">
        <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" placeholder="Search projects…" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link key={p.id as string} to={`/projects/${p.id}`} className="card hover:shadow-md transition-shadow group">
              <div className="flex items-start justify-between mb-3">
                <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                  <FolderIcon className="h-5 w-5 text-blue-600" />
                </div>
                <span className={STATUS_COLORS[p.status as string] || 'badge-gray'}>{p.status as string}</span>
              </div>
              <h3 className="font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">{p.name as string}</h3>
              <p className="text-sm text-gray-500 mt-0.5">{p.code as string}</p>
              {!!(p.client) && (
                <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-300" />
                  {(p.client as { name: string }).name}
                </p>
              )}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-500">{(p._count as { members: number })?.members || 0} members</span>
                <span className={p.billable ? 'badge-green' : 'badge-gray'}>{p.billable ? 'Billable' : 'Internal'}</span>
              </div>
            </Link>
          ))}
          {projects.length === 0 && (
            <div className="col-span-3 card text-center py-16 text-gray-400">
              <FolderIcon className="h-12 w-12 mx-auto mb-3 text-gray-200" />
              <p className="font-medium">No projects found</p>
              {isManager && (
                <p className="text-sm mt-1">
                  You need to <Link to="/clients" className="text-primary-600 hover:underline">create a client</Link> first, then create a project.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="text-lg font-bold text-gray-900">Create Project</h3>
              <button onClick={() => { setShowModal(false); reset(); }} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit(d => createMutation.mutate(d))} className="p-6 space-y-4">

              {clients.length === 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>No active clients available. <Link to="/clients" className="font-medium underline">Create a client first.</Link></span>
                </div>
              )}

              <div>
                <label className="label">Client <span className="text-red-500">*</span></label>
                <select {...register('clientId', { required: 'Client is required' })} className="input">
                  <option value="">Select a client…</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {errors.clientId && <p className="error-msg">{errors.clientId.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Project Name <span className="text-red-500">*</span></label>
                  <input {...register('name', { required: 'Project name is required' })} className="input" placeholder="Project name" />
                  {errors.name && <p className="error-msg">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="label">Code <span className="text-red-500">*</span></label>
                  <input {...register('code', { required: 'Code is required' })} className="input" placeholder="PROJ-001" />
                  {errors.code && <p className="error-msg">{errors.code.message}</p>}
                </div>
              </div>

              <div>
                <label className="label">Description</label>
                <textarea {...register('description')} rows={2} className="input" placeholder="Brief description…" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Budget Hours</label>
                  <input {...register('budgetHours', { valueAsNumber: true })} type="number" min="0" className="input" placeholder="0" />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select {...register('billable')} className="input">
                    <option value="true">Billable</option>
                    <option value="false">Internal</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start Date</label>
                  <input {...register('startDate')} type="date" className="input" />
                </div>
                <div>
                  <label className="label">End Date</label>
                  <input {...register('endDate')} type="date" className="input" />
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => { setShowModal(false); reset(); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createMutation.isPending || clients.length === 0} className="btn-primary">
                  {createMutation.isPending ? 'Creating…' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
