import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { PlusIcon, PaperClipIcon, PencilIcon, XMarkIcon } from '@heroicons/react/24/outline';
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

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'INR', 'PHP', 'MYR', 'AED', 'JPY', 'CNY'];
const CATEGORIES = ['Travel', 'Accommodation', 'Meals', 'Equipment', 'Software', 'Training', 'Marketing', 'Office Supplies', 'Communication', 'Medical', 'Other'];

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

interface ExpenseFormProps {
  onClose: () => void;
  initialValues?: Partial<FormValues> & { id?: string };
  projects: { id: string; name: string }[];
  isEdit?: boolean;
}

function ExpenseForm({ onClose, initialValues, projects, isEdit }: ExpenseFormProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      currency: 'USD',
      date: format(new Date(), 'yyyy-MM-dd'),
      ...initialValues,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      let receiptUrl: string | undefined;

      // Upload document if selected (#20)
      if (selectedFile) {
        const fd = new FormData();
        fd.append('file', selectedFile);
        try {
          const up = await api.post('/expenses/upload-receipt', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
          receiptUrl = up.data?.url;
        } catch {
          // non-fatal — proceed without receipt
        }
      }

      const payload = { ...data, amount: Number(data.amount), ...(receiptUrl ? { receiptUrl } : {}) };
      if (isEdit && initialValues?.id) {
        return api.put(`/expenses/${initialValues.id}`, payload).then(r => r.data);
      }
      return api.post('/expenses', payload).then(r => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      toast.success(isEdit ? 'Expense updated' : 'Expense created');
      onClose();
    },
    onError: () => toast.error(isEdit ? 'Failed to update expense' : 'Failed to create expense'),
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{isEdit ? 'Edit Expense' : 'Add Expense'}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XMarkIcon className="h-5 w-5" /></button>
      </div>
      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
          <select {...register('category')} className="input-field w-full">
            <option value="">Select category</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount *</label>
          <input type="number" step="0.01" {...register('amount', { valueAsNumber: true })} className="input-field w-full" placeholder="0.00" />
          {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
          <select {...register('currency')} className="input-field w-full">
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
          <input type="date" {...register('date')} className="input-field w-full" />
          {errors.date && <p className="text-red-500 text-xs mt-1">{errors.date.message}</p>}
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
          <input type="text" {...register('description')} className="input-field w-full" placeholder="What was this expense for?" />
          {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Project <span className="text-gray-400 font-normal">(optional)</span></label>
          <select {...register('projectId')} className="input-field w-full">
            <option value="">No project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <input type="text" {...register('notes')} className="input-field w-full" placeholder="Additional notes" />
        </div>

        {/* Supporting document upload (#20) */}
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Supporting Document <span className="text-gray-400 font-normal">(optional — receipt, medical cert, etc.)</span>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-secondary btn-sm flex items-center gap-2"
            >
              <PaperClipIcon className="h-4 w-4" />
              {selectedFile ? 'Change File' : 'Attach File'}
            </button>
            {selectedFile && (
              <span className="text-sm text-gray-600 flex items-center gap-1">
                <PaperClipIcon className="h-3.5 w-3.5" /> {selectedFile.name}
                <button type="button" onClick={() => setSelectedFile(null)} className="ml-1 text-red-400 hover:text-red-600">
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.heic"
            className="hidden"
            onChange={e => setSelectedFile(e.target.files?.[0] || null)}
          />
          <p className="text-xs text-gray-400 mt-1">Accepted: PDF, JPG, PNG, HEIC (max 5 MB)</p>
        </div>

        <div className="col-span-2 flex gap-3">
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Expense'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </form>
    </div>
  );
}

export default function ExpensesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const isManager = hasRole(user?.role, [...ADMIN_ROLES, ...MANAGEMENT_ROLES]);

  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<(FormValues & { id: string }) | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', statusFilter],
    queryFn: () => api.get('/expenses', { params: { status: statusFilter || undefined } }).then(r => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects', { params: { limit: 100 } }).then(r => r.data),
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

  const total = expenses.reduce((s: number, e: { amount: number }) => s + e.amount, 0);
  const pending = expenses.filter((e: { status: string }) => e.status === 'SUBMITTED').length;
  const reimbursed = expenses.filter((e: { status: string }) => e.status === 'REIMBURSED').reduce((s: number, e: { amount: number }) => s + e.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('expenses.title')}</h1>
        <button onClick={() => { setShowForm(v => !v); setEditingExpense(null); }} className="btn-primary flex items-center gap-2">
          <PlusIcon className="h-4 w-4" />
          {t('expenses.addExpense')}
        </button>
      </div>

      {/* Summary */}
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
      {showForm && !editingExpense && (
        <ExpenseForm
          onClose={() => setShowForm(false)}
          projects={Array.isArray(projectList) ? projectList : []}
        />
      )}

      {/* Edit form (#18) */}
      {editingExpense && (
        <ExpenseForm
          isEdit
          initialValues={editingExpense}
          onClose={() => setEditingExpense(null)}
          projects={Array.isArray(projectList) ? projectList : []}
        />
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
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

      {/* Table */}
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
                status: string; receiptUrl?: string; notes?: string; projectId?: string;
                user: { firstName: string; lastName: string };
              }) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{format(new Date(e.date), 'dd MMM yyyy')}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{e.category}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs">
                    <div className="flex items-start gap-1">
                      {e.receiptUrl && <PaperClipIcon className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 mt-0.5" />}
                      <span className="break-words">{e.description}</span>
                    </div>
                  </td>
                  {isManager && <td className="px-4 py-3 text-gray-600">{e.user?.firstName} {e.user?.lastName}</td>}
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                    {e.currency} {e.amount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[e.status])}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {/* Edit draft (#18) */}
                      {e.status === 'DRAFT' && (
                        <button
                          onClick={() => {
                            setEditingExpense({
                              id: e.id,
                              category: e.category,
                              amount: e.amount,
                              currency: e.currency,
                              date: format(new Date(e.date), 'yyyy-MM-dd'),
                              description: e.description,
                              projectId: e.projectId || '',
                              notes: e.notes || '',
                            });
                            setShowForm(false);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="text-xs text-gray-600 hover:underline flex items-center gap-0.5"
                        >
                          <PencilIcon className="h-3 w-3" /> Edit
                        </button>
                      )}
                      {e.status === 'DRAFT' && (
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
                        <button
                          onClick={() => { if (confirm('Delete this expense? This cannot be undone.')) deleteMutation.mutate(e.id); }}
                          className="text-xs text-red-400 hover:underline ml-1"
                        >
                          Delete
                        </button>
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
