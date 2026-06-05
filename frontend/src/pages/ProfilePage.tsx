import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useAuthStore } from '../store/auth.store';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { ShieldCheckIcon, KeyIcon } from '@heroicons/react/24/outline';

export default function ProfilePage() {
  const { user, refreshUser } = useAuthStore();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'profile' | 'security'>('profile');
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);

  const { register, handleSubmit } = useForm({ defaultValues: { firstName: user?.firstName, lastName: user?.lastName, phone: '', timezone: user?.organization?.timezone } });
  const { register: regPwd, handleSubmit: hsPwd, reset: resetPwd } = useForm();
  const { register: regMfa, handleSubmit: hsMfa } = useForm();

  const updateMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.put(`/users/${user?.id}`, d),
    onSuccess: () => { toast.success('Profile updated'); refreshUser(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const pwdMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.post('/auth/change-password', d),
    onSuccess: () => { toast.success('Password changed'); resetPwd(); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  const setupMfaMutation = useMutation({
    mutationFn: () => api.post('/auth/setup-mfa'),
    onSuccess: (r) => setMfaSetup(r.data),
  });

  const verifyMfaMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.post('/auth/verify-mfa', d),
    onSuccess: () => { toast.success('MFA enabled!'); setMfaSetup(null); refreshUser(); },
    onError: () => toast.error('Invalid code'),
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>

      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {['profile', 'security'].map(t => (
          <button key={t} onClick={() => setTab(t as typeof tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="card space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary-100 flex items-center justify-center text-2xl font-bold text-primary-700">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{user?.firstName} {user?.lastName}</h2>
              <p className="text-gray-500">{user?.email}</p>
              <p className="text-sm text-gray-400">{user?.role?.replace(/_/g, ' ')}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit(d => updateMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">First Name</label>
                <input {...register('firstName')} className="input" />
              </div>
              <div>
                <label className="label">Last Name</label>
                <input {...register('lastName')} className="input" />
              </div>
            </div>
            <div>
              <label className="label">Phone</label>
              <input {...register('phone')} className="input" type="tel" />
            </div>
            <div>
              <label className="label">Timezone</label>
              <input {...register('timezone')} className="input" />
            </div>
            <button type="submit" disabled={updateMutation.isPending} className="btn-primary">Save Changes</button>
          </form>
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-6">
          <div className="card space-y-4">
            <div className="flex items-center gap-3">
              <KeyIcon className="h-6 w-6 text-gray-400" />
              <h3 className="font-semibold text-gray-900">Change Password</h3>
            </div>
            <form onSubmit={hsPwd(d => pwdMutation.mutate(d as Record<string, unknown>))} className="space-y-3">
              <div>
                <label className="label">Current Password</label>
                <input {...regPwd('currentPassword', { required: true })} type="password" className="input" />
              </div>
              <div>
                <label className="label">New Password</label>
                <input {...regPwd('newPassword', { required: true, minLength: 8 })} type="password" className="input" />
              </div>
              <button type="submit" disabled={pwdMutation.isPending} className="btn-primary btn-sm">Update Password</button>
            </form>
          </div>

          <div className="card space-y-4">
            <div className="flex items-center gap-3">
              <ShieldCheckIcon className="h-6 w-6 text-gray-400" />
              <div>
                <h3 className="font-semibold text-gray-900">Two-Factor Authentication</h3>
                <p className="text-sm text-gray-500">Add an extra layer of security</p>
              </div>
              {user?.mfaEnabled && <span className="badge-green ml-auto">Enabled</span>}
            </div>

            {!user?.mfaEnabled && !mfaSetup && (
              <button onClick={() => setupMfaMutation.mutate()} disabled={setupMfaMutation.isPending} className="btn-secondary btn-sm">
                Enable MFA
              </button>
            )}

            {mfaSetup && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">Scan this QR code or manually enter the secret in your authenticator app:</p>
                <div className="bg-gray-50 rounded-lg p-3 font-mono text-sm break-all">{mfaSetup.secret}</div>
                <form onSubmit={hsMfa(d => verifyMfaMutation.mutate(d as Record<string, unknown>))} className="flex gap-3">
                  <input {...regMfa('code', { required: true })} className="input max-w-32" placeholder="000000" maxLength={6} />
                  <button type="submit" disabled={verifyMfaMutation.isPending} className="btn-primary btn-sm">Verify & Enable</button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
