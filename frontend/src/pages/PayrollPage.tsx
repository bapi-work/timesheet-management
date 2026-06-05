import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { format } from 'date-fns';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { PlusIcon, ArrowDownTrayIcon, LockClosedIcon } from '@heroicons/react/24/outline';

export default function PayrollPage() {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const { register, handleSubmit, reset } = useForm();

  const { data: periods = [], isLoading } = useQuery({
    queryKey: ['payroll', 'periods'],
    queryFn: () => api.get('/payroll/periods').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.post('/payroll/periods', d),
    onSuccess: () => { toast.success('Period created'); qc.invalidateQueries({ queryKey: ['payroll'] }); setShowModal(false); reset(); },
  });

  const processMutation = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/periods/${id}/process`, {}, { responseType: 'blob' }),
    onSuccess: (r, id) => {
      toast.success('Payroll processed & downloaded!');
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a'); a.href = url; a.download = `payroll.xlsx`; a.click();
      qc.invalidateQueries({ queryKey: ['payroll'] });
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payroll</h1>
          <p className="text-sm text-gray-500">Process payroll and export employee hours</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          <PlusIcon className="h-4 w-4" /> New Period
        </button>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Period</th>
              <th className="th">Start Date</th>
              <th className="th">End Date</th>
              <th className="th">Status</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <tr><td colSpan={5} className="td text-center py-10"><div className="h-6 w-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
            ) : (periods as Record<string, unknown>[]).map(p => (
              <tr key={p.id as string} className="tr-hover">
                <td className="td font-medium">{p.name as string}</td>
                <td className="td">{format(new Date(p.startDate as string), 'MMM d, yyyy')}</td>
                <td className="td">{format(new Date(p.endDate as string), 'MMM d, yyyy')}</td>
                <td className="td">
                  {p.lockedAt ? (
                    <span className="badge-purple flex items-center gap-1 w-fit"><LockClosedIcon className="h-3 w-3" /> Locked</span>
                  ) : p.processedAt ? (
                    <span className="badge-green">Processed</span>
                  ) : (
                    <span className="badge-yellow">Pending</span>
                  )}
                </td>
                <td className="td">
                  {!p.lockedAt && (
                    <button
                      onClick={() => {
                        if (confirm(`Process payroll for "${p.name}"? This will lock all approved timesheets.`)) {
                          processMutation.mutate(p.id as string);
                        }
                      }}
                      disabled={processMutation.isPending}
                      className="btn-primary btn-sm"
                    >
                      <ArrowDownTrayIcon className="h-4 w-4" /> Process & Export
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && !(periods as unknown[]).length && (
              <tr><td colSpan={5} className="td text-center text-gray-400 py-10">No payroll periods created</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold mb-5">Create Payroll Period</h3>
            <form onSubmit={handleSubmit(d => createMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
              <div>
                <label className="label">Period Name *</label>
                <input {...register('name', { required: true })} className="input" placeholder="e.g. June 2025" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start Date *</label>
                  <input {...register('startDate', { required: true })} type="date" className="input" />
                </div>
                <div>
                  <label className="label">End Date *</label>
                  <input {...register('endDate', { required: true })} type="date" className="input" />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setShowModal(false); reset(); }} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
