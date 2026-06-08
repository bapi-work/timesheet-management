import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { PlusIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import api from '../lib/api';
import { useAuthStore } from '../store/auth.store';
import { hasRole, ADMIN_ROLES, MANAGEMENT_ROLES } from '../lib/roles';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SUBMITTED: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  REIMBURSED: 'bg-purple-100 text-purple-700',
};

const schema = z.object({
  category: z.string().min(1, 'Category is required'),
  amount: z.number({ invalid_type_error: 'Amount required' }).positive(),
  currency: z.string().default('USD'),
  date: z.string().min(1, 'Date required'),
  description: z.string().min(1, 'Description required'),
  projectId: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const CATEGORIES = ['Travel', 'Accommodation', 'Meals', 'Equipment', 'Software', 'Training', 'Marketing', 'Office Supplies', 'Communication', 'Other'];

export default function ExpensesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const isManager = hasRole(user?.role, [...ADMIN_ROLES, ...MANAGEMENT_ROLES]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', statusFilter],
    queryFn: () => api.get('/expenses', { params: { status: statusFilter || undefined } }).then(r => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects', { params: { limit: 100 } }).then(r => r.data),
  });

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currency: 'USD', date: format(new Date(), 'yyyy-MM-dd') },
  });

  const createMutation = useMutation({
    mutationFn: (data: FormValues) => api.post('/expenses', { ...data, amount: Number(data.amount) }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Expense created');
      setShowForm(false);
      reset();
    },
    onError: () => toast.error('Failed to create expense'),
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.post(`/expenses/${id}/submit`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense submitted for approval'); },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/expenses/${id}/approve`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense approved'); },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/expenses/${id}/reject`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense rejected'); },
  });

  const reimburseMutation = useMutation({
    mutationFn: (id: string) => api.post(`/expenses/${id}/reimburse`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Expense reimbursed'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Deleted'); },
  });

  const expenses = data?.expenses || [];
  const projectList = projects?.projects || projects || [];

  const onSubmit = (values: FormValues) => {
    createMutation.mutate(values);
  };

  // Summary stats
  const total = expenses.reduce((s: number, e: { amount: number }) => s + e.amount, 0);
  const pending = expenses.filter((e: { status: string }) => e.status === 'SUBMITTED').length;
  const reimbursed = expenses.filter((e: { status: string }) => e.status === 'REIMBURSED').reduce((s: number, e: { amount: number }) => s + e.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('expenses.title')}</h1>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary flex items-center gap-2">
          <PlusIcon className="h-4 w-4" />
          {t('expenses.addExpense')}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Total Expenses</p>
          <p className="text-2xl font-bold text-gray-900">${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Pending Approval</p>
          <p className="text-2xl font-bold text-blue-600">{pending}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Reimbursed</p>
          <p className="text-2xl font-bold text-green-600">${reimbursed.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('expenses.addExpense')}</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('expenses.category')} *</label>
              <select {...register('category')} className="input-field w-full">
                <option value="">Select category</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.amount')} *</label>
              <input type="number" step="0.01" {...register('amount', { valueAsNumber: true })} className="input-field w-full" placeholder="0.00" />
              {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.currency')}</label>
              <select {...register('currency')} className="input-field w-full">
                {['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'INR'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.date')} *</label>
              <input type="date" {...register('date')} className="input-field w-full" />
              {errors.date && <p className="text-red-500 text-xs mt-1">{errors.date.message}</p>}
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.description')} *</label>
              <input type="text" {...register('description')} className="input-field w-full" placeholder="What was this expense for?" />
              {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project ({t('common.optional')})</label>
              <select {...register('projectId')} className="input-field w-full">
                <option value="">No project</option>
                {(Array.isArray(projectList) ? projectList : []).map((p: { id: string; name: string }) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.notes')} ({t('common.optional')})</label>
              <input type="text" {...register('notes')} className="input-field w-full" />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                {createMutation.isPending ? 'Saving...' : t('common.save')}
              </button>
              <button type="button" onClick={() => { setShowForm(false); reset(); }} className="btn-secondary">
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {['', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSED'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={clsx('px-3 py-1.5 rounded-lg text-sm border', statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Expenses table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">{t('common.loading')}</div>
        ) : expenses.length === 0 ? (
          <div className="p-8 text-center text-gray-500">{t('common.noData')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('common.date')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('expenses.category')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('common.description')}</th>
                {isManager && <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>}
                <th className="text-right px-4 py-3 font-medium text-gray-600">{t('common.amount')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('common.status')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expenses.map((e: {
                id: string; date: string; category: string; description: string; amount: number; currency: string;
                status: string; receiptUrl?: string; user: { firstName: string; lastName: string };
              }) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">{format(new Date(e.date), 'dd MMM yyyy')}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{e.category}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs truncate">
                    {e.receiptUrl && <PaperClipIcon className="h-3.5 w-3.5 inline mr-1 text-gray-400" />}
                    {e.description}
                  </td>
                  {isManager && <td className="px-4 py-3 text-gray-600">{e.user?.firstName} {e.user?.lastName}</td>}
                  <td className="px-4 py-3 text-right font-medium">
                    {e.currency} {e.amount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[e.status])}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {e.status === 'DRAFT' && e.user?.firstName === user?.firstName && (
                        <button onClick={() => submitMutation.mutate(e.id)} className="text-xs text-blue-600 hover:underline">Submit</button>
                      )}
                      {isManager && e.status === 'SUBMITTED' && (
                        <>
                          <button onClick={() => approveMutation.mutate(e.id)} className="text-xs text-green-600 hover:underline">Approve</button>
                          <button onClick={() => rejectMutation.mutate(e.id)} className="text-xs text-red-600 hover:underline">Reject</button>
                        </>
                      )}
                      {hasRole(user?.role, ADMIN_ROLES) && e.status === 'APPROVED' && (
                        <button onClick={() => reimburseMutation.mutate(e.id)} className="text-xs text-purple-600 hover:underline">Reimburse</button>
                      )}
                      {['DRAFT', 'REJECTED'].includes(e.status) && (
                        <button onClick={() => { if (confirm('Delete?')) deleteMutation.mutate(e.id); }} className="text-xs text-red-400 hover:underline ml-2">Delete</button>
                      )}
                    </div>
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
