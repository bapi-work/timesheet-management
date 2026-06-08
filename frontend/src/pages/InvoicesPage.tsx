import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import api from '../lib/api';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT: 'bg-blue-100 text-blue-700',
  PAID: 'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-400',
};

const itemSchema = z.object({
  description: z.string().min(1, 'Required'),
  quantity: z.number({ invalid_type_error: 'Required' }).positive(),
  unitPrice: z.number({ invalid_type_error: 'Required' }).min(0),
  projectId: z.string().optional(),
});

const schema = z.object({
  clientId: z.string().min(1, 'Client required'),
  dueDate: z.string().min(1, 'Due date required'),
  currency: z.string().default('USD'),
  taxRate: z.number().min(0).max(100).default(0),
  discount: z.number().min(0).default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  items: z.array(itemSchema).min(1, 'At least one item required'),
});

type FormValues = z.infer<typeof schema>;

export default function InvoicesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [viewInvoice, setViewInvoice] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', statusFilter],
    queryFn: () => api.get('/invoices', { params: { status: statusFilter || undefined } }).then(r => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['invoices-stats'],
    queryFn: () => api.get('/invoices/stats/summary').then(r => r.data),
  });

  const { data: clients } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get('/clients', { params: { limit: 100 } }).then(r => r.data),
  });

  const { register, handleSubmit, control, watch, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      currency: 'USD',
      taxRate: 0,
      discount: 0,
      items: [{ description: '', quantity: 1, unitPrice: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');
  const taxRate = watch('taxRate') || 0;
  const discount = watch('discount') || 0;
  const subtotal = items.reduce((s, i) => s + (i.quantity || 0) * (i.unitPrice || 0), 0);
  const taxAmount = ((subtotal - discount) * taxRate) / 100;
  const total = subtotal - discount + taxAmount;

  const createMutation = useMutation({
    mutationFn: (data: FormValues) => api.post('/invoices', data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoices-stats'] });
      toast.success('Invoice created');
      setShowForm(false);
      reset();
    },
    onError: () => toast.error('Failed to create invoice'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.put(`/invoices/${id}`, { status }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoices-stats'] });
      toast.success('Status updated');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/invoices/${id}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoices-stats'] });
      toast.success('Invoice deleted');
    },
  });

  const invoices = data?.invoices || [];
  const clientList = clients?.clients || clients || [];

  const onSubmit = (values: FormValues) => createMutation.mutate(values);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('invoices.title')}</h1>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary flex items-center gap-2">
          <PlusIcon className="h-4 w-4" />
          {t('invoices.createInvoice')}
        </button>
      </div>

      {/* Summary stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Outstanding', value: `$${((stats.sent?._sum?.total || 0) + (stats.overdue?._sum?.total || 0)).toLocaleString()}`, color: 'text-blue-600' },
            { label: 'Paid', value: `$${(stats.paid?._sum?.total || 0).toLocaleString()}`, color: 'text-green-600' },
            { label: 'Overdue', value: stats.overdue?._count || 0, color: 'text-red-600' },
            { label: 'Draft', value: stats.draft?._count || 0, color: 'text-gray-600' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={clsx('text-2xl font-bold', s.color)}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('invoices.createInvoice')}</h2>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.client')} *</label>
                <select {...register('clientId')} className="input-field w-full">
                  <option value="">Select client</option>
                  {(Array.isArray(clientList) ? clientList : []).map((c: { id: string; name: string }) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {errors.clientId && <p className="text-red-500 text-xs mt-1">{errors.clientId.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.dueDate')} *</label>
                <input type="date" {...register('dueDate')} className="input-field w-full" />
                {errors.dueDate && <p className="text-red-500 text-xs mt-1">{errors.dueDate.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.currency')}</label>
                <select {...register('currency')} className="input-field w-full">
                  {['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700">Line Items *</h3>
                <button type="button" onClick={() => append({ description: '', quantity: 1, unitPrice: 0 })} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                  <PlusIcon className="h-3.5 w-3.5" /> {t('invoices.addItem')}
                </button>
              </div>
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">Description</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-600 w-20">{t('invoices.quantity')}</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">{t('invoices.unitPrice')}</th>
                      <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">Amount</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {fields.map((field, i) => (
                      <tr key={field.id}>
                        <td className="px-2 py-1">
                          <input {...register(`items.${i}.description`)} className="input-field w-full text-sm" placeholder="Item description" />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" step="0.5" {...register(`items.${i}.quantity`, { valueAsNumber: true })} className="input-field w-full text-sm text-center" />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" step="0.01" {...register(`items.${i}.unitPrice`, { valueAsNumber: true })} className="input-field w-full text-sm text-right" />
                        </td>
                        <td className="px-3 py-1 text-right font-medium text-gray-700">
                          ${((items[i]?.quantity || 0) * (items[i]?.unitPrice || 0)).toFixed(2)}
                        </td>
                        <td className="px-2 py-1">
                          {fields.length > 1 && (
                            <button type="button" onClick={() => remove(i)} className="text-red-400 hover:text-red-600">
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errors.items && <p className="text-red-500 text-xs mt-1">At least one item required</p>}
            </div>

            {/* Totals & taxes */}
            <div className="flex justify-end">
              <div className="w-64 space-y-2 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Discount</span>
                  <input type="number" step="0.01" {...register('discount', { valueAsNumber: true })} className="input-field w-24 text-right text-sm" placeholder="0.00" />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Tax Rate (%)</span>
                  <input type="number" step="0.5" {...register('taxRate', { valueAsNumber: true })} className="input-field w-24 text-right text-sm" placeholder="0" />
                </div>
                {taxRate > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Tax ({taxRate}%)</span>
                    <span>${taxAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 border-t pt-2">
                  <span>Total</span>
                  <span>${total.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoices.terms')}</label>
                <input type="text" {...register('terms')} className="input-field w-full" placeholder="e.g. Net 30" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.notes')}</label>
                <input type="text" {...register('notes')} className="input-field w-full" />
              </div>
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                {createMutation.isPending ? 'Saving...' : t('invoices.createInvoice')}
              </button>
              <button type="button" onClick={() => { setShowForm(false); reset(); }} className="btn-secondary">{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2">
        {['', 'DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={clsx('px-3 py-1.5 rounded-lg text-sm border', statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Invoice table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">{t('common.loading')}</div>
        ) : invoices.length === 0 ? (
          <div className="p-8 text-center text-gray-500">{t('common.noData')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('invoices.invoiceNumber')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('invoices.client')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('invoices.issueDate')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('invoices.dueDate')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">{t('invoices.total')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('common.status')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv: {
                id: string; invoiceNumber: string; client: { name: string }; issueDate: string;
                dueDate: string; total: number; currency: string; status: string;
              }) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-medium text-blue-600 cursor-pointer hover:underline"
                    onClick={() => api.get(`/invoices/${inv.id}`).then(r => setViewInvoice(r.data))}>
                    {inv.invoiceNumber}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{inv.client?.name}</td>
                  <td className="px-4 py-3 text-gray-600">{format(new Date(inv.issueDate), 'dd MMM yyyy')}</td>
                  <td className="px-4 py-3 text-gray-600">{format(new Date(inv.dueDate), 'dd MMM yyyy')}</td>
                  <td className="px-4 py-3 text-right font-medium">{inv.currency} {inv.total.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[inv.status])}>{inv.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {inv.status === 'DRAFT' && (
                        <button onClick={() => updateStatusMutation.mutate({ id: inv.id, status: 'SENT' })} className="text-xs text-blue-600 hover:underline">Mark Sent</button>
                      )}
                      {inv.status === 'SENT' && (
                        <button onClick={() => updateStatusMutation.mutate({ id: inv.id, status: 'PAID' })} className="text-xs text-green-600 hover:underline">Mark Paid</button>
                      )}
                      {['DRAFT', 'SENT'].includes(inv.status) && (
                        <button onClick={() => updateStatusMutation.mutate({ id: inv.id, status: 'CANCELLED' })} className="text-xs text-gray-400 hover:underline">Cancel</button>
                      )}
                      {inv.status !== 'PAID' && (
                        <button onClick={() => { if (confirm('Delete invoice?')) deleteMutation.mutate(inv.id); }} className="text-xs text-red-400 hover:underline">Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Invoice detail modal */}
      {viewInvoice && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-bold">Invoice {(viewInvoice as { invoiceNumber: string }).invoiceNumber}</h2>
              <button onClick={() => setViewInvoice(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between text-sm">
                <div>
                  <p className="font-medium text-gray-900">Bill To</p>
                  <p className="text-gray-600">{(viewInvoice.client as { name: string })?.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">Issue Date: {format(new Date(viewInvoice.issueDate as string), 'dd MMM yyyy')}</p>
                  <p className="text-sm text-gray-500">Due Date: {format(new Date(viewInvoice.dueDate as string), 'dd MMM yyyy')}</p>
                  <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[viewInvoice.status as string])}>{viewInvoice.status as string}</span>
                </div>
              </div>
              <table className="w-full text-sm border-t border-gray-200">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left py-2 px-3">Description</th>
                    <th className="text-center py-2 px-3">Qty</th>
                    <th className="text-right py-2 px-3">Unit Price</th>
                    <th className="text-right py-2 px-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {((viewInvoice.items || []) as Array<{ id: string; description: string; quantity: number; unitPrice: number; amount: number }>).map(item => (
                    <tr key={item.id} className="border-t border-gray-100">
                      <td className="py-2 px-3">{item.description}</td>
                      <td className="py-2 px-3 text-center">{item.quantity}</td>
                      <td className="py-2 px-3 text-right">{(viewInvoice.currency as string)} {item.unitPrice.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right font-medium">{(viewInvoice.currency as string)} {item.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end">
                <div className="w-48 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>${(viewInvoice.subtotal as number).toFixed(2)}</span></div>
                  {(viewInvoice.discount as number) > 0 && <div className="flex justify-between"><span className="text-gray-500">Discount</span><span>-${(viewInvoice.discount as number).toFixed(2)}</span></div>}
                  {(viewInvoice.taxRate as number) > 0 && <div className="flex justify-between"><span className="text-gray-500">Tax ({viewInvoice.taxRate as number}%)</span><span>${(viewInvoice.taxAmount as number).toFixed(2)}</span></div>}
                  <div className="flex justify-between font-bold border-t pt-1"><span>Total</span><span>{viewInvoice.currency as string} {(viewInvoice.total as number).toFixed(2)}</span></div>
                </div>
              </div>
              {viewInvoice.terms && <p className="text-sm text-gray-600"><span className="font-medium">Terms:</span> {viewInvoice.terms as string}</p>}
              {viewInvoice.notes && <p className="text-sm text-gray-600"><span className="font-medium">Notes:</span> {viewInvoice.notes as string}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
