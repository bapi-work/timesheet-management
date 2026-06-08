import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownTrayIcon, ArrowUpTrayIcon, ServerIcon,
  CloudIcon, CheckCircleIcon, XCircleIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import api from '../lib/api';

type TabId = 'export' | 'restore' | 'ftp' | 'cloud';

export default function BackupPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('export');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [ftpForm, setFtpForm] = useState({ host: '', port: '21', user: '', password: '', remotePath: '/backups' });
  const [cloudForm, setCloudForm] = useState({ endpoint: '', bucket: '', accessKey: '', secretKey: '', region: 'us-east-1' });

  const { data: logs } = useQuery({
    queryKey: ['backup-logs'],
    queryFn: () => api.get('/backup/logs').then(r => r.data),
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      api.get('/backup/export', { responseType: 'blob' }).then(r => {
        const url = window.URL.createObjectURL(new Blob([r.data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
        return r.data;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backup-logs'] });
      toast.success('Backup downloaded successfully');
    },
    onError: () => toast.error('Export failed'),
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (!restoreFile) throw new Error('No file selected');
      const text = await restoreFile.text();
      const data = JSON.parse(text);
      return api.post('/backup/restore', { data }).then(r => r.data);
    },
    onSuccess: (result: { message: string; tables: string[] }) => {
      toast.success(result.message || 'Restore info retrieved');
    },
    onError: (e: Error) => toast.error(e.message || 'Restore failed'),
  });

  const ftpMutation = useMutation({
    mutationFn: () => api.post('/backup/ftp', { ...ftpForm, port: parseInt(ftpForm.port) }).then(r => r.data),
    onSuccess: (result: { message: string }) => {
      qc.invalidateQueries({ queryKey: ['backup-logs'] });
      toast.success(result.message || 'FTP upload successful');
    },
    onError: () => toast.error('FTP upload failed'),
  });

  const cloudMutation = useMutation({
    mutationFn: () => api.post('/backup/cloud', cloudForm).then(r => r.data),
    onSuccess: (result: { message: string }) => {
      qc.invalidateQueries({ queryKey: ['backup-logs'] });
      toast.success(result.message || 'Cloud backup successful');
    },
    onError: () => toast.error('Cloud upload failed'),
  });

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'export', label: t('backup.exportData'), icon: ArrowDownTrayIcon },
    { id: 'restore', label: t('backup.importData'), icon: ArrowUpTrayIcon },
    { id: 'ftp', label: t('backup.ftpUpload'), icon: ServerIcon },
    { id: 'cloud', label: t('backup.cloudUpload'), icon: CloudIcon },
  ];

  const formatBytes = (bytes?: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('backup.title')}</h1>
      </div>

      {/* Tab navigation */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50',
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* Export tab */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-1">Export All Data</h3>
                <p className="text-sm text-blue-700">
                  Downloads a complete JSON backup of your organisation's data including timesheets, projects,
                  clients, expenses, invoices, departments, leave requests and attendance records.
                  Passwords and MFA secrets are excluded.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="font-medium text-gray-700">Included</p>
                  <ul className="mt-1 space-y-0.5 text-gray-600">
                    {['Users (no passwords)', 'Timesheets & Entries', 'Projects & Tasks', 'Clients', 'Expenses', 'Invoices', 'Departments', 'Leave Requests', 'Attendance Records'].map(i => (
                      <li key={i} className="flex items-center gap-1">
                        <CheckCircleIcon className="h-3.5 w-3.5 text-green-500" /> {i}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="font-medium text-gray-700">Excluded (security)</p>
                  <ul className="mt-1 space-y-0.5 text-gray-600">
                    {['Password hashes', 'MFA secrets', 'Refresh tokens', 'API keys'].map(i => (
                      <li key={i} className="flex items-center gap-1">
                        <XCircleIcon className="h-3.5 w-3.5 text-red-400" /> {i}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <button
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                {exportMutation.isPending ? 'Generating backup...' : t('backup.downloadBackup')}
              </button>
            </div>
          )}

          {/* Restore tab */}
          {activeTab === 'restore' && (
            <div className="space-y-4">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-semibold text-yellow-900 mb-1">⚠️ Restore / Import</h3>
                <p className="text-sm text-yellow-700">
                  Upload a previously exported JSON backup file to validate and inspect its contents.
                  Full data restoration requires DBA access or running <code className="bg-yellow-100 px-1 rounded">prisma db seed</code> with the backup data.
                </p>
              </div>
              <div
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:border-blue-400 transition-colors cursor-pointer"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file?.type === 'application/json' || file?.name.endsWith('.json')) {
                    setRestoreFile(file);
                  } else {
                    toast.error('Please drop a .json file');
                  }
                }}
                onClick={() => document.getElementById('restore-file-input')?.click()}
              >
                <input
                  id="restore-file-input"
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={e => setRestoreFile(e.target.files?.[0] || null)}
                />
                <ArrowUpTrayIcon className="h-10 w-10 text-gray-400 mx-auto mb-3" />
                {restoreFile ? (
                  <div>
                    <p className="text-sm font-medium text-gray-900">{restoreFile.name}</p>
                    <p className="text-xs text-gray-500">{formatBytes(restoreFile.size)}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-600">Drop a backup .json file here, or click to browse</p>
                  </div>
                )}
              </div>
              {restoreFile && (
                <button
                  onClick={() => restoreMutation.mutate()}
                  disabled={restoreMutation.isPending}
                  className="btn-primary"
                >
                  {restoreMutation.isPending ? 'Validating...' : 'Validate & Inspect Backup'}
                </button>
              )}
              {restoreMutation.isSuccess && restoreMutation.data && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
                  <p className="font-medium text-green-800 mb-1">{(restoreMutation.data as { message: string }).message}</p>
                  <p className="text-green-700">Tables in backup: {(restoreMutation.data as { tables: string[] }).tables?.join(', ')}</p>
                </div>
              )}
            </div>
          )}

          {/* FTP tab */}
          {activeTab === 'ftp' && (
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
                Configure an FTP server to automatically upload backups. The server must be reachable from the backend container.
                For full FTP upload, add <code className="bg-gray-100 px-1 rounded">basic-ftp</code> to the backend package.json.
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('backup.ftpHost')} *</label>
                  <input type="text" value={ftpForm.host} onChange={e => setFtpForm(f => ({ ...f, host: e.target.value }))}
                    className="input-field w-full" placeholder="ftp.example.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('backup.ftpPort')}</label>
                  <input type="number" value={ftpForm.port} onChange={e => setFtpForm(f => ({ ...f, port: e.target.value }))}
                    className="input-field w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('backup.ftpUser')} *</label>
                  <input type="text" value={ftpForm.user} onChange={e => setFtpForm(f => ({ ...f, user: e.target.value }))}
                    className="input-field w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('backup.ftpPassword')} *</label>
                  <input type="password" value={ftpForm.password} onChange={e => setFtpForm(f => ({ ...f, password: e.target.value }))}
                    className="input-field w-full" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('backup.remotePath')}</label>
                  <input type="text" value={ftpForm.remotePath} onChange={e => setFtpForm(f => ({ ...f, remotePath: e.target.value }))}
                    className="input-field w-full" placeholder="/backups" />
                </div>
              </div>
              <button
                onClick={() => ftpMutation.mutate()}
                disabled={ftpMutation.isPending || !ftpForm.host || !ftpForm.user}
                className="btn-primary flex items-center gap-2"
              >
                <ServerIcon className="h-4 w-4" />
                {ftpMutation.isPending ? 'Uploading...' : 'Upload Backup via FTP'}
              </button>
            </div>
          )}

          {/* Cloud tab */}
          {activeTab === 'cloud' && (
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
                Upload backups to S3-compatible storage: AWS S3, DigitalOcean Spaces, Cloudflare R2, or MinIO.
                Add <code className="bg-gray-100 px-1 rounded">@aws-sdk/client-s3</code> to the backend for full upload support.
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('backup.s3Endpoint')} *</label>
                  <input type="url" value={cloudForm.endpoint} onChange={e => setCloudForm(f => ({ ...f, endpoint: e.target.value }))}
                    className="input-field w-full" placeholder="https://nyc3.digitaloceanspaces.com" />
                  <p className="text-xs text-gray-400 mt-1">DO Spaces: https://nyc3.digitaloceanspaces.com · AWS S3: https://s3.amazonaws.com · R2: https://&lt;account&gt;.r2.cloudflarestorage.com</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('backup.s3Bucket')} *</label>
                  <input type="text" value={cloudForm.bucket} onChange={e => setCloudForm(f => ({ ...f, bucket: e.target.value }))}
                    className="input-field w-full" placeholder="my-backups" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('backup.s3Region')}</label>
                  <input type="text" value={cloudForm.region} onChange={e => setCloudForm(f => ({ ...f, region: e.target.value }))}
                    className="input-field w-full" placeholder="us-east-1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('backup.s3AccessKey')} *</label>
                  <input type="text" value={cloudForm.accessKey} onChange={e => setCloudForm(f => ({ ...f, accessKey: e.target.value }))}
                    className="input-field w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('backup.s3SecretKey')} *</label>
                  <input type="password" value={cloudForm.secretKey} onChange={e => setCloudForm(f => ({ ...f, secretKey: e.target.value }))}
                    className="input-field w-full" />
                </div>
              </div>
              <button
                onClick={() => cloudMutation.mutate()}
                disabled={cloudMutation.isPending || !cloudForm.endpoint || !cloudForm.bucket}
                className="btn-primary flex items-center gap-2"
              >
                <CloudIcon className="h-4 w-4" />
                {cloudMutation.isPending ? 'Uploading...' : 'Upload to Cloud Storage'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Backup history */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{t('backup.backupHistory')}</h2>
        </div>
        {!logs || logs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No backup history yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">File</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Size</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Destination</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log: {
                id: string; createdAt: string; type: string; fileName: string;
                fileSizeBytes?: number; destination?: string; status: string; errorMessage?: string;
              }) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600">{format(new Date(log.createdAt), 'dd MMM yyyy HH:mm')}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs uppercase">{log.type}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-xs truncate">{log.fileName}</td>
                  <td className="px-4 py-3 text-gray-600">{formatBytes(log.fileSizeBytes)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{log.destination || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', log.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                      {log.status}
                    </span>
                    {log.errorMessage && <p className="text-xs text-red-500 mt-0.5">{log.errorMessage}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
