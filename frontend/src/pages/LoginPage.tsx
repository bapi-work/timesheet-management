import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuthStore } from '../store/auth.store';
import { useBranding } from '../context/BrandingContext';
import { ClockIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
  mfaCode: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const { branding } = useBranding();
  const [showPassword, setShowPassword] = useState(false);
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const appName = branding.appName || 'TimeTrack Pro';

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      const result = await login(data.email, data.password, data.mfaCode);
      if (result.requiresMfa) {
        setRequiresMfa(true);
        toast.success('Enter your MFA code');
      } else {
        navigate('/dashboard');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Login failed';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen login-branded flex items-center justify-center p-4" style={{ background: `linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 90%, black), var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))` }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={appName} className="h-14 mx-auto object-contain mb-4" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-white/20 backdrop-blur mb-4">
              <ClockIcon className="h-9 w-9 text-white" />
            </div>
          )}
          <h1 className="text-3xl font-bold text-white">{appName}</h1>
          <p className="text-white/70 mt-1">Enterprise Timesheet Management</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <input {...register('email')} type="email" className={`input ${errors.email ? 'input-error' : ''}`} placeholder="you@company.com" autoComplete="email" />
              {errors.email && <p className="error-msg">{errors.email.message}</p>}
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input {...register('password')} type={showPassword ? 'text' : 'password'} className={`input pr-10 ${errors.password ? 'input-error' : ''}`} placeholder="••••••••" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="error-msg">{errors.password.message}</p>}
            </div>

            {requiresMfa && (
              <div>
                <label className="label">MFA Code</label>
                <input {...register('mfaCode')} type="text" className="input" placeholder="000000" maxLength={6} autoComplete="one-time-code" />
              </div>
            )}

            <button type="submit" disabled={isLoading} className="btn-primary w-full btn-lg mt-2">
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-600 font-semibold mb-2">Demo credentials:</p>
            <div className="space-y-1 text-xs text-gray-600">
              <p><span className="font-medium">Admin:</span> admin@acme.com / Admin@123</p>
              <p><span className="font-medium">HR:</span> hr@acme.com / HRAdmin@123</p>
              <p><span className="font-medium">Employee:</span> john.doe@acme.com / Employee@123</p>
            </div>
          </div>

          {branding.footerText && (
            <p className="text-xs text-gray-400 text-center mt-4">{branding.footerText}</p>
          )}
        </div>
      </div>
    </div>
  );
}
