import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import {
  BuildingOffice2Icon, ArrowLeftIcon, EnvelopeIcon, PhoneIcon,
  GlobeAltIcon, MapPinIcon, ReceiptPercentIcon, FolderIcon,
  UserGroupIcon, UserPlusIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/auth.store';
import { MANAGEMENT_ROLES, hasRole } from '../lib/roles';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'badge-green', ON_HOLD: 'badge-yellow', COMPLETED: 'badge-blue',
  CANCELLED: 'badge-red', ARCHIVED: 'badge-gray',
};

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500 w-36 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-900 flex-1">{value}</span>
    </div>
  );
}

interface ClientMember {
  id: string;
  userId: string;
  role?: string;
  user: { id: string; firstName: string; lastName: string; employeeId: string; designation?: string };
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  designation?: string;
}

function AddMemberModal({ clientId, existingMemberIds, onClose }: { clientId: string; existingMemberIds: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('');

  const { data: usersData } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => api.get('/users?limit=200').then(r => r.data),
  });
  const employees: Employee[] = (usersData?.users || []).filter((u: Employee) => !existingMemberIds.includes(u.id));

  const mutation = useMutation({
    mutationFn: () => api.post(`/clients/${clientId}/members`, { userId, role: role || undefined }),
    onSuccess: () => {
      toast.success('Member added');
      qc.invalidateQueries({ queryKey: ['client', clientId] });
      onClose();
    },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Failed to add member'),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-900">Add Member</h3>
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
            <label className="label">Role (optional)</label>
            <input value={role} onChange={e => setRole(e.target.value)} className="input" placeholder="e.g. Project Lead" />
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

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore(s => s.user);
  const isManager = hasRole(user?.role, MANAGEMENT_ROLES);
  const [showAddMember, setShowAddMember] = useState(false);
  const qc = useQueryClient();

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.get(`/clients/${id}`).then(r => r.data),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/clients/${id}/members/${userId}`),
    onSuccess: () => {
      toast.success('Member removed');
      qc.invalidateQueries({ queryKey: ['client', id] });
    },
    onError: () => toast.error('Failed to remove member'),
  });

  if (isLoading) return <div className="flex items-center justify-center h-48 text-gray-400">Loading…</div>;
  if (!client) return <div className="text-center py-12 text-gray-400">Client not found</div>;

  const address = [client.address, client.city, client.state, client.zipCode, client.country].filter(Boolean).join(', ');
  const memberIds: string[] = (client.clientMembers || []).map((m: ClientMember) => m.userId);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link to="/clients" className="p-2 rounded-lg text-gray-400 hover:bg-gray-100">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
          {client.code && <p className="text-sm text-gray-500">{client.code}</p>}
        </div>
        <span className={`ml-auto ${client.isActive ? 'badge-green' : 'badge-gray'}`}>
          {client.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <EnvelopeIcon className="h-5 w-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900">Contact</h2>
          </div>
          <div className="space-y-3 text-sm">
            {client.contactPerson && (
              <p className="font-medium text-gray-900">{client.contactPerson}</p>
            )}
            {client.contactEmail && (
              <a href={`mailto:${client.contactEmail}`} className="flex items-center gap-2 text-primary-600 hover:underline">
                <EnvelopeIcon className="h-4 w-4" />{client.contactEmail}
              </a>
            )}
            {client.contactPhone && (
              <a href={`tel:${client.contactPhone}`} className="flex items-center gap-2 text-gray-600">
                <PhoneIcon className="h-4 w-4" />{client.contactPhone}
              </a>
            )}
            {client.website && (
              <a href={client.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary-600 hover:underline truncate">
                <GlobeAltIcon className="h-4 w-4 flex-shrink-0" />
                {client.website.replace(/^https?:\/\//, '')}
              </a>
            )}
            {!client.contactPerson && !client.contactEmail && !client.contactPhone && (
              <p className="text-gray-400 text-xs">No contact details</p>
            )}
          </div>
        </div>

        {/* Address */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <MapPinIcon className="h-5 w-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900">Address</h2>
          </div>
          {address ? (
            <p className="text-sm text-gray-700 leading-relaxed">{address}</p>
          ) : (
            <p className="text-gray-400 text-xs">No address provided</p>
          )}
        </div>

        {/* Tax Details */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <ReceiptPercentIcon className="h-5 w-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900">Tax Details</h2>
          </div>
          <div className="space-y-1">
            <InfoRow label="Tax ID" value={client.taxId} />
            <InfoRow label="Tax Type" value={client.taxType} />
          </div>
          {!client.taxId && <p className="text-gray-400 text-xs">No tax details</p>}
        </div>
      </div>

      {/* Members */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <UserGroupIcon className="h-5 w-5 text-gray-400" />
            <h2 className="font-semibold text-gray-900">Assigned Employees ({client.clientMembers?.length || 0})</h2>
          </div>
          {isManager && (
            <button onClick={() => setShowAddMember(true)} className="btn-primary btn-sm flex items-center gap-1.5">
              <UserPlusIcon className="h-4 w-4" /> Add Employee
            </button>
          )}
        </div>
        {!client.clientMembers?.length ? (
          <p className="text-gray-400 text-sm">No employees assigned to this client</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {client.clientMembers.map((m: ClientMember) => (
              <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700 flex-shrink-0">
                  {m.user.firstName[0]}{m.user.lastName[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{m.user.firstName} {m.user.lastName}</p>
                  <p className="text-xs text-gray-500">{m.role || m.user.designation || m.user.employeeId}</p>
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

      {/* Projects */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <FolderIcon className="h-5 w-5 text-gray-400" />
          <h2 className="font-semibold text-gray-900">Projects ({client.projects?.length || 0})</h2>
        </div>
        {client.projects?.length === 0 ? (
          <p className="text-gray-400 text-sm">No projects for this client</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {client.projects?.map((p: Record<string, unknown>) => (
              <div key={p.id as string} className="flex items-center justify-between py-3">
                <div>
                  <Link to={`/projects/${p.id as string}`} className="font-medium text-gray-900 hover:text-primary-600">
                    {p.name as string}
                  </Link>
                  <p className="text-xs text-gray-400 mt-0.5">{p.code as string}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!!(p.billable) && <span className="badge-green text-xs">Billable</span>}
                  <span className={STATUS_COLORS[p.status as string] || 'badge-gray'}>{p.status as string}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      {client.notes && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-2">Notes</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{client.notes}</p>
        </div>
      )}

      {showAddMember && (
        <AddMemberModal
          clientId={id!}
          existingMemberIds={memberIds}
          onClose={() => setShowAddMember(false)}
        />
      )}
    </div>
  );
}
