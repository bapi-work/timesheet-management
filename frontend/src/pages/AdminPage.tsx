import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  PlusIcon, ArrowUpTrayIcon, ArrowDownTrayIcon, UserPlusIcon,
  SwatchIcon, PhotoIcon, InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { useBranding } from '../context/BrandingContext';
import EmployeeFormModal from '../components/EmployeeFormModal';

type Tab = 'org' | 'branding' | 'employees' | 'holidays' | 'audit';

interface BrandingForm {
  appName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  loginBgColor: string;
  sidebarBgColor: string;
  footerText: string;
  supportEmail: string;
}

function ColorInput({ label, name, register, defaultValue, hint }: {
  label: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" {...register(name)} defaultValue={defaultValue || '#2563eb'} className="h-9 w-14 rounded border border-gray-300 p-0.5 cursor-pointer" />
        <input type="text" {...register(name)} defaultValue={defaultValue || ''} className="input flex-1 font-mono text-sm" placeholder="#2563eb" />
      </div>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'org' || tabParam === 'branding' || tabParam === 'employees' || tabParam === 'holidays' || tabParam === 'audit') {
      return tabParam;
    }
    return 'org';
  });

  useEffect(() => {
    setSearchParams({ tab });
  }, [tab, setSearchParams]);

  const qc = useQueryClient();
  const { refetch: refetchBranding } = useBranding();
  const { register: regOrg, handleSubmit: hsOrg } = useForm();
  const { register: regBranding, handleSubmit: hsBranding } = useForm<BrandingForm>();
  const [showUserModal, setShowUserModal] = useState(false);

  const { data: org } = useQuery({
    queryKey: ['admin', 'org'],
    queryFn: () => api.get('/admin/organization').then(r => r.data),
    enabled: tab === 'org' || tab === 'branding',
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ['admin', 'holidays'],
    queryFn: () => api.get('/leave/holidays').then(r => r.data),
    enabled: tab === 'holidays',
  });

  const { data: auditData } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.get('/admin/audit-logs?limit=50').then(r => r.data),
    enabled: tab === 'audit',
  });

  const { register: regHoliday, handleSubmit: hsHoliday, reset: resetHoliday } = useForm();

  const updateOrgMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.put('/admin/organization', d),
    onSuccess: () => { toast.success('Settings saved'); qc.invalidateQueries({ queryKey: ['admin', 'org'] }); },
  });

  const updateBrandingMutation = useMutation({
    mutationFn: (d: BrandingForm) => api.put('/admin/branding', d),
    onSuccess: () => {
      toast.success('Branding saved — changes apply immediately');
      qc.invalidateQueries({ queryKey: ['admin', 'org'] });
      refetchBranding();
    },
    onError: () => toast.error('Failed to save branding'),
  });

  const createHolidayMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.post('/admin/holidays', d),
    onSuccess: () => { toast.success('Holiday added'); qc.invalidateQueries({ queryKey: ['admin', 'holidays'] }); resetHoliday(); },
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/holidays/${id}`),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['admin', 'holidays'] }); },
  });

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    const r = await api.post('/admin/import-employees', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    toast.success(`Imported ${r.data.created} employees`);
    if (r.data.failed > 0) toast.error(`${r.data.failed} failed`);
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: 'org', label: 'Organization' },
    { key: 'branding', label: 'Branding' },
    { key: 'employees', label: 'Employees' },
    { key: 'holidays', label: 'Holidays' },
    { key: 'audit', label: 'Audit Logs' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Administration</h1>

      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Organization Settings */}
      {tab === 'org' && org && (
        <form onSubmit={hsOrg(d => updateOrgMutation.mutate(d as Record<string, unknown>))} className="card space-y-4 max-w-lg">
          <h3 className="font-semibold text-gray-900">Organization Settings</h3>
          <div>
            <label className="label">Organization Name</label>
            <input {...regOrg('name')} defaultValue={org.name} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Timezone</label>
              <input {...regOrg('timezone')} defaultValue={org.timezone} className="input" />
            </div>
            <div>
              <label className="label">Timesheet Period</label>
              <select {...regOrg('timesheetPeriod')} defaultValue={org.timesheetPeriod} className="input">
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Biweekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Working Hours/Day</label>
              <input {...regOrg('workingHoursPerDay', { valueAsNumber: true })} defaultValue={org.workingHoursPerDay} type="number" className="input" />
            </div>
            <div>
              <label className="label">Overtime Threshold (hrs)</label>
              <input {...regOrg('overtimeThreshold', { valueAsNumber: true })} defaultValue={org.overtimeThreshold} type="number" className="input" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Support Email</label>
              <input {...regOrg('supportEmail')} defaultValue={org.supportEmail || ''} type="email" className="input" placeholder="support@company.com" />
            </div>
            <div>
              <label className="label">Footer Text</label>
              <input {...regOrg('footerText')} defaultValue={org.footerText || ''} className="input" placeholder="© 2026 Acme Corp" />
            </div>
          </div>
          <button type="submit" disabled={updateOrgMutation.isPending} className="btn-primary">
            {updateOrgMutation.isPending ? 'Saving…' : 'Save Settings'}
          </button>
        </form>
      )}

      {/* Branding */}
      {tab === 'branding' && org && (
        <form onSubmit={hsBranding(d => updateBrandingMutation.mutate(d))} className="space-y-6 max-w-2xl">
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
            <InformationCircleIcon className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <p>Branding changes are applied immediately across the application. Use your organization's brand colors and logo to personalize the experience.</p>
          </div>

          {/* Identity */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <PhotoIcon className="h-5 w-5 text-gray-400" />
              <h3 className="font-semibold text-gray-900">Identity</h3>
            </div>
            <div>
              <label className="label">Application Name</label>
              <input {...regBranding('appName')} defaultValue={org.appName || ''} className="input" placeholder="TimeTrack Pro" />
              <p className="text-xs text-gray-400 mt-1">Shown in the sidebar and browser tab. Defaults to "TimeTrack Pro".</p>
            </div>
            <div>
              <label className="label">Logo URL</label>
              <input {...regBranding('logoUrl')} defaultValue={org.logoUrl || ''} className="input" placeholder="https://cdn.example.com/logo.png" />
              <p className="text-xs text-gray-400 mt-1">Shown in sidebar header. Recommended: 200×50px PNG with transparent background.</p>
            </div>
            <div>
              <label className="label">Favicon URL</label>
              <input {...regBranding('faviconUrl')} defaultValue={org.faviconUrl || ''} className="input" placeholder="https://cdn.example.com/favicon.ico" />
              <p className="text-xs text-gray-400 mt-1">Browser tab icon. Recommended: 32×32px ICO or PNG.</p>
            </div>
          </div>

          {/* Colors */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <SwatchIcon className="h-5 w-5 text-gray-400" />
              <h3 className="font-semibold text-gray-900">Colors</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ColorInput label="Primary Color" name="primaryColor" register={regBranding} defaultValue={org.primaryColor} hint="Main accent — buttons, links, active states" />
              <ColorInput label="Secondary Color" name="secondaryColor" register={regBranding} defaultValue={org.secondaryColor} hint="Secondary elements and badges" />
              <ColorInput label="Accent Color" name="accentColor" register={regBranding} defaultValue={org.accentColor} hint="Highlights and hover states" />
              <ColorInput label="Sidebar Background" name="sidebarBgColor" register={regBranding} defaultValue={org.sidebarBgColor} hint="Navigation sidebar background" />
              <ColorInput label="Login Page Background" name="loginBgColor" register={regBranding} defaultValue={org.loginBgColor} hint="Background color of the login screen" />
            </div>
          </div>

          {/* Preview */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-3">Live Preview</h3>
            <div className="flex gap-3 flex-wrap">
              <button type="button" className="btn-primary">Primary Button</button>
              <button type="button" className="btn-secondary">Secondary</button>
              <span className="badge-green">Active</span>
              <span className="badge-yellow">Pending</span>
              <span className="badge-red">Rejected</span>
              <span className="badge-blue">Approved</span>
            </div>
            <p className="text-xs text-gray-400 mt-3">Colors update in real-time after saving.</p>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={updateBrandingMutation.isPending} className="btn-primary">
              {updateBrandingMutation.isPending ? 'Saving…' : 'Save Branding'}
            </button>
            <button type="button" onClick={() => updateBrandingMutation.mutate({
              appName: '', logoUrl: '', faviconUrl: '',
              primaryColor: '#2563eb', secondaryColor: '#64748b', accentColor: '#0ea5e9',
              sidebarBgColor: '#ffffff', loginBgColor: '#f1f5f9', footerText: '', supportEmail: '',
            })} className="btn-secondary">
              Reset to Defaults
            </button>
          </div>
        </form>
      )}

      {tab === 'employees' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <button onClick={() => setShowUserModal(true)} className="btn-primary">
              <UserPlusIcon className="h-4 w-4" /> Add Employee
            </button>
            <label className="btn-secondary cursor-pointer">
              <ArrowUpTrayIcon className="h-4 w-4" /> Import XLSX
              <input type="file" accept=".xlsx,.csv" className="hidden" onChange={handleImport} />
            </label>
            <button onClick={async () => {
              const r = await api.get('/admin/export-employees', { responseType: 'blob' });
              const url = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = url; a.download = 'employees.xlsx'; a.click();
            }} className="btn-secondary">
              <ArrowDownTrayIcon className="h-4 w-4" /> Export All
            </button>
          </div>
          <div className="card">
            <p className="text-sm text-gray-600">Use the Employees page to browse, search and manage employees. Use Import to bulk-upload from an Excel template with columns: Employee ID, First Name, Last Name, Email, Designation.</p>
          </div>
        </div>
      )}

      {tab === 'holidays' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card space-y-4">
            <h3 className="font-semibold">Add Holiday</h3>
            <form onSubmit={hsHoliday(d => createHolidayMutation.mutate(d as Record<string, unknown>))} className="space-y-3">
              <div>
                <label className="label">Name *</label>
                <input {...regHoliday('name', { required: true })} className="input" placeholder="Holiday name" />
              </div>
              <div>
                <label className="label">Date *</label>
                <input {...regHoliday('date', { required: true })} type="date" className="input" />
              </div>
              <label className="flex items-center gap-2">
                <input {...regHoliday('isOptional')} type="checkbox" className="rounded" />
                <span className="text-sm">Optional Holiday</span>
              </label>
              <button type="submit" disabled={createHolidayMutation.isPending} className="btn-primary btn-sm">Add</button>
            </form>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b font-semibold text-sm">Holidays ({(holidays as unknown[]).length})</div>
            <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
              {(holidays as Record<string, unknown>[]).map(h => (
                <div key={h.id as string} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                  <div>
                    <p className="text-sm font-medium">{h.name as string}</p>
                    <p className="text-xs text-gray-500">{format(new Date(h.date as string), 'EEEE, MMMM d, yyyy')}</p>
                  </div>
                  <button onClick={() => deleteHolidayMutation.mutate(h.id as string)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th className="th">User</th>
                <th className="th">Action</th>
                <th className="th">Entity</th>
                <th className="th">IP</th>
                <th className="th">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {(auditData?.logs || []).map((log: Record<string, unknown>) => (
                <tr key={log.id as string} className="tr-hover">
                  <td className="td">{log.user ? `${(log.user as Record<string, string>).firstName} ${(log.user as Record<string, string>).lastName}` : 'System'}</td>
                  <td className="td"><span className={`badge ${log.action === 'DELETE' ? 'badge-red' : log.action === 'POST' ? 'badge-green' : 'badge-blue'}`}>{log.action as string}</span></td>
                  <td className="td text-gray-500">{log.entity as string}{log.entityId ? `/${(log.entityId as string).slice(0, 8)}…` : ''}</td>
                  <td className="td text-gray-400 text-xs">{log.ipAddress as string}</td>
                  <td className="td text-gray-400 text-xs">{format(new Date(log.createdAt as string), 'MMM d, HH:mm')}</td>
                </tr>
              ))}
              {!auditData?.logs?.length && (
                <tr><td colSpan={5} className="td text-center text-gray-400 py-10">No audit logs</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showUserModal && <EmployeeFormModal onClose={() => setShowUserModal(false)} />}
    </div>
  );
}
