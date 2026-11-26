import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowDownTrayIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import api from '../lib/api';

interface UploadProblems { message: string; errors?: string[]; moreErrors?: number }

// HR and Admin set every employee's leave entitlements for a year from one spreadsheet
export default function LeaveBalanceUploadModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [file, setFile] = useState<File | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [problems, setProblems] = useState<UploadProblems | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const r = await api.get(`/leave/balances/template?year=${year}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `leave-balances-${year}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not download the template');
    } finally {
      setDownloading(false);
    }
  };

  const upload = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('year', String(year));
      fd.append('file', f);
      return api.post('/leave/balances/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: (r) => {
      toast.success(r.data.message);
      qc.invalidateQueries({ queryKey: ['leave'] });
      onClose();
    },
    onError: (e: unknown) => {
      const data = (e as { response?: { data?: UploadProblems } })?.response?.data;
      setProblems({ message: data?.message || 'Upload failed', errors: data?.errors, moreErrors: data?.moreErrors });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Upload Leave Balances</h3>
          <p className="text-sm text-gray-500 mt-1">Set how many days of each leave type every employee is entitled to.</p>
        </div>

        <div>
          <label className="label">Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="input max-w-[10rem]">
            {[thisYear - 1, thisYear, thisYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900">1. Download the template</p>
          <p className="text-sm text-gray-500">It lists every active employee with their current {year} balances. Enter days under each leave type; half days such as 1.5 are fine. Leave a cell empty to keep that balance as it is.</p>
          <button type="button" onClick={downloadTemplate} disabled={downloading} className="btn-secondary btn-sm flex items-center gap-1.5">
            <ArrowDownTrayIcon className="h-4 w-4" /> {downloading ? 'Downloading…' : `Download ${year} Template`}
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-900">2. Upload the filled-in file</p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={e => { setFile(e.target.files?.[0] || null); setProblems(null); }}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
          />
          <p className="text-xs text-gray-400">Excel or CSV. Nothing is saved if any row has a mistake.</p>
        </div>

        {problems && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 space-y-1" role="alert">
            <p className="font-medium">{problems.message}</p>
            {problems.errors && (
              <ul className="list-disc pl-5 space-y-0.5 max-h-48 overflow-y-auto">
                {problems.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            )}
            {!!problems.moreErrors && <p>…and {problems.moreErrors} more.</p>}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            type="button"
            disabled={!file || upload.isPending}
            onClick={() => file && upload.mutate(file)}
            className="btn-primary flex items-center gap-1.5"
          >
            <ArrowUpTrayIcon className="h-4 w-4" /> {upload.isPending ? 'Uploading…' : 'Upload Balances'}
          </button>
        </div>
      </div>
    </div>
  );
}
