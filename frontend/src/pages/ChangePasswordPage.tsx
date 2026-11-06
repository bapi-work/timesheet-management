import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuthStore } from '../store/auth.store';

const schema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(10, 'Password must be at least 10 characters')
    .regex(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&_\-#])[A-Za-z\d@$!%*?&_\-#]{10,}/, 'Must include uppercase, lowercase, number and special character (@$!%*?&_-#)'),
  confirmPassword: z.string(),
}).refine(d => d.newPassword === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

type FormData = z.infer<typeof schema>;

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { completePasswordChange, logout } = useAuthStore();
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: FormData) => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: (r) => {
      completePasswordChange(r.data.accessToken);
      toast.success('Password changed');
      navigate('/dashboard', { replace: true });
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to change password'),
  });

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-2xl font-bold text-gray-900">Set a new password</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">You signed in with a temporary password. Choose your own to continue.</p>

        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
          <div>
            <label className="label">Temporary password</label>
            <input {...register('currentPassword')} type="password" className="input" autoComplete="current-password" />
            {errors.currentPassword && <p className="error-msg">{errors.currentPassword.message}</p>}
          </div>
          <div>
            <label className="label">New password</label>
            <input {...register('newPassword')} type="password" className="input" autoComplete="new-password" />
            {errors.newPassword && <p className="error-msg">{errors.newPassword.message}</p>}
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input {...register('confirmPassword')} type="password" className="input" autoComplete="new-password" />
            {errors.confirmPassword && <p className="error-msg">{errors.confirmPassword.message}</p>}
          </div>
          <button type="submit" disabled={mutation.isPending} className="btn-primary w-full">
            {mutation.isPending ? 'Saving...' : 'Change password'}
          </button>
          <button type="button" onClick={() => logout().then(() => navigate('/login', { replace: true }))} className="btn-secondary w-full">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
