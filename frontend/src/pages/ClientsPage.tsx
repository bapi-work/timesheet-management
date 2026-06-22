import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  BuildingOffice2Icon, PlusIcon, MagnifyingGlassIcon,
  PencilIcon, TrashIcon, XMarkIcon, CheckIcon, PhoneIcon,
  EnvelopeIcon, GlobeAltIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/auth.store';
import { ADMIN_ROLES, MANAGEMENT_ROLES, hasRole } from '../lib/roles';

interface Client {
  id: string;
  name: string;
  code?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  taxId?: string;
  taxType?: string;
  website?: string;
  notes?: string;
  isActive: boolean;
  _count?: { projects: number };
}

interface ClientFormData {
  name: string;
  code: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  taxId: string;
  taxType: string;
  website: string;
  notes: string;
}

function ClientModal({ client, onClose }: { client?: Client; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = !!client;

  const { register, handleSubmit, formState: { errors } } = useForm<ClientFormData>({
    defaultValues: client ? {
      name: client.name,
      code: client.code || '',
      contactPerson: client.contactPerson || '',
      contactEmail: client.contactEmail || '',
      contactPhone: client.contactPhone || '',
      address: client.address || '',
      city: client.city || '',
      state: client.state || '',
      country: client.country || '',
      zipCode: client.zipCode || '',
      taxId: client.taxId || '',
      taxType: client.taxType || '',
      website: client.website || '',
      notes: client.notes || '',
    } : {},
  });

  const mutation = useMutation({
    mutationFn: (data: Partial<ClientFormData>) =>
      isEdit
        ? api.put(`/clients/${client!.id}`, data).then(r => r.data)
        : api.post('/clients', data).then(r => r.data),
    onSuccess: () => {
      toast.success(isEdit ? 'Client updated' : 'Client created');
      qc.invalidateQueries({ queryKey: ['clients'] });
      onClose();
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message || 'Failed to save client');
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">{isEdit ? 'Edit Client' : 'New Client'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100"><XMarkIcon className="h-5 w-5" /></button>
        </div>

        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="p-6 space-y-6">
          {/* Basic Info */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Client Name <span className="text-red-500">*</span></label>
                <input {...register('name', { required: 'Client name is required' })} className="input" placeholder="Acme Corporation" />
                {errors.name && <p className="error-msg">{errors.name.message}</p>}
              </div>
              <div>
                <label className="label">Client Code</label>
                <input {...register('code')} className="input" placeholder="ACME" />
              </div>
              <div>
                <label className="label">Website</label>
                <input {...register('website')} className="input" placeholder="https://example.com" />
              </div>
            </div>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Contact Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Contact Person</label>
                <input {...register('contactPerson')} className="input" placeholder="John Smith" />
              </div>
              <div>
                <label className="label">Contact Email</label>
                <input {...register('contactEmail')} type="email" className="input" placeholder="john@example.com" />
              </div>
              <div>
                <label className="label">Contact Phone</label>
                <input {...register('contactPhone')} className="input" placeholder="+1 555 000 0000" />
              </div>
            </div>
          </div>

          {/* Address */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Address</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Street Address</label>
                <input {...register('address')} className="input" placeholder="123 Main Street" />
              </div>
              <div>
                <label className="label">City</label>
                <input {...register('city')} className="input" placeholder="New York" />
              </div>
              <div>
                <label className="label">State / Province</label>
                <input {...register('state')} className="input" placeholder="NY" />
              </div>
              <div>
                <label className="label">Country</label>
                <input {...register('country')} className="input" placeholder="United States" />
              </div>
              <div>
                <label className="label">ZIP / Postal Code</label>
                <input {...register('zipCode')} className="input" placeholder="10001" />
              </div>
            </div>
          </div>

          {/* Tax Details */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Tax Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Tax ID / VAT Number</label>
                <input {...register('taxId')} className="input" placeholder="US-123456789" />
              </div>
              <div>
                <label className="label">Tax Type</label>
                <select {...register('taxType')} className="input">
                  <option value="">Select type</option>
                  <option value="GST">GST</option>
                  <option value="VAT">VAT</option>
                  <option value="EIN">EIN (US)</option>
                  <option value="PAN">PAN</option>
                  <option value="TIN">TIN</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="label">Notes</label>
            <textarea {...register('notes')} rows={3} className="input" placeholder="Additional information about this client..." />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              <CheckIcon className="h-4 w-4" />
              {mutation.isPending ? 'Saving…' : (isEdit ? 'Update Client' : 'Create Client')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editClient, setEditClient] = useState<Client | undefined>();
  const canManageClients = hasRole(user?.role, MANAGEMENT_ROLES);
  const canDeleteClients = hasRole(user?.role, MANAGEMENT_ROLES);

  const { data, isLoading } = useQuery({
    queryKey: ['clients', search],
    queryFn: () => api.get('/clients', { params: { search: search || undefined, limit: 100 } }).then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: () => { toast.success('Client deleted'); qc.invalidateQueries({ queryKey: ['clients'] }); },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Cannot delete client'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.put(`/clients/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });

  const clients: Client[] = data?.clients || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-0.5">{data?.total || 0} clients</p>
        </div>
        {canManageClients && (
          <button onClick={() => { setEditClient(undefined); setShowModal(true); }} className="btn-primary">
            <PlusIcon className="h-4 w-4" /> New Client
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search clients…"
          className="input pl-9"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : clients.length === 0 ? (
        <div className="card text-center py-16">
          <BuildingOffice2Icon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No clients yet</p>
          {canManageClients && (
            <>
              <p className="text-sm text-gray-400 mt-1">Create your first client to get started</p>
              <button onClick={() => setShowModal(true)} className="btn-primary mt-4">
                <PlusIcon className="h-4 w-4" /> New Client
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {clients.map((client: Client) => (
            <div key={client.id} className={`card hover:shadow-md transition-shadow ${!client.isActive ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <BuildingOffice2Icon className="h-5 w-5 text-primary-600" />
                  </div>
                  <div>
                    <Link to={`/clients/${client.id}`} className="font-semibold text-gray-900 hover:text-primary-600 transition-colors">
                      {client.name}
                    </Link>
                    {client.code && <p className="text-xs text-gray-400">{client.code}</p>}
                  </div>
                </div>
                <span className={client.isActive ? 'badge-green' : 'badge-gray'}>
                  {client.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="space-y-1.5 text-sm text-gray-500 mb-4">
                {client.contactPerson && (
                  <p className="flex items-center gap-2 truncate">
                    <span className="font-medium text-gray-700">{client.contactPerson}</span>
                  </p>
                )}
                {client.contactEmail && (
                  <p className="flex items-center gap-2 truncate">
                    <EnvelopeIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {client.contactEmail}
                  </p>
                )}
                {client.contactPhone && (
                  <p className="flex items-center gap-2">
                    <PhoneIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    {client.contactPhone}
                  </p>
                )}
                {client.website && (
                  <p className="flex items-center gap-2 truncate">
                    <GlobeAltIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    <a href={client.website} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline truncate">
                      {client.website.replace(/^https?:\/\//, '')}
                    </a>
                  </p>
                )}
                {(client.city || client.country) && (
                  <p>{[client.city, client.country].filter(Boolean).join(', ')}</p>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">{client._count?.projects || 0} project{(client._count?.projects || 0) !== 1 ? 's' : ''}</span>
                {(canManageClients || canDeleteClients) && (
                  <div className="flex items-center gap-1">
                    {canManageClients && (
                      <>
                        <button
                          onClick={() => toggleActive.mutate({ id: client.id, isActive: !client.isActive })}
                          className="p-1.5 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 text-xs"
                          title={client.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {client.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => { setEditClient(client); setShowModal(true); }}
                          className="p-1.5 rounded text-gray-400 hover:bg-gray-100 hover:text-primary-600"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    {canDeleteClients && (client._count?.projects || 0) === 0 && (
                    <button
                      onClick={() => { if (confirm(`Delete client "${client.name}"?`)) deleteMutation.mutate(client.id); }}
                      className="p-1.5 rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && canManageClients && (
        <ClientModal
          client={editClient}
          onClose={() => { setShowModal(false); setEditClient(undefined); }}
        />
      )}
    </div>
  );
}
