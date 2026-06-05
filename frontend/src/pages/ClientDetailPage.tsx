import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import {
  BuildingOffice2Icon, ArrowLeftIcon, EnvelopeIcon, PhoneIcon,
  GlobeAltIcon, MapPinIcon, ReceiptPercentIcon, FolderIcon,
} from '@heroicons/react/24/outline';

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

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.get(`/clients/${id}`).then(r => r.data),
  });

  if (isLoading) return <div className="flex items-center justify-center h-48 text-gray-400">Loading…</div>;
  if (!client) return <div className="text-center py-12 text-gray-400">Client not found</div>;

  const address = [client.address, client.city, client.state, client.zipCode, client.country].filter(Boolean).join(', ');

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
    </div>
  );
}
