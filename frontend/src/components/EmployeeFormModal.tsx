import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';
import api from '../lib/api';

interface EmployeeFormValues {
  firstName: string;
  lastName: string;
  employeeId: string;
  email: string;
  role: string;
  designation?: string;
  phone?: string;
  timezone?: string;
  joinDate?: string;
  isActive?: boolean;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  email: string;
  role: string;
  designation?: string;
  phone?: string;
  timezone?: string;
  joinDate?: string;
  isActive?: boolean;
}

interface EmployeeFormModalProps {
  onClose: () => void;
  employee?: Employee;
}

export default function EmployeeFormModal({ onClose, employee }: EmployeeFormModalProps) {
  const qc = useQueryClient();
  const isEdit = !!employee;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<EmployeeFormValues>({
    defaultValues: { role: 'EMPLOYEE' },
  });

  useEffect(() => {
    if (employee) {
      reset({
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeId: employee.employeeId,
        email: employee.email,
        role: employee.role,
        designation: employee.designation || '',
        phone: employee.phone || '',
        timezone: employee.timezone || '',
        joinDate: employee.joinDate ? employee.joinDate.split('T')[0] : '',
        isActive: employee.isActive,
      });
    }
  }, [employee, reset]);

  const createMutation = useMutation({
    mutationFn: (data: EmployeeFormValues) => {
      const payload = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== '' && value !== undefined && value !== null)
      );
      return api.post('/users', payload);
    },
    onSuccess: (r) => {
      toast.success(`Employee created! Temp password: ${r.data.tempPassword}`);
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['admin'] });
      reset();
      onClose();
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to create employee');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: EmployeeFormValues) => {
      const payload = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== '' && value !== undefined && value !== null)
      );
      return api.put(`/users/${employee!.id}`, payload);
    },
    onSuccess: () => {
      toast.success('Employee updated successfully');
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee', employee!.id] });
      qc.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (e: unknown) => {
      toast.error((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to update employee');
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = (data: EmployeeFormValues) => {
    if (isEdit) updateMutation.mutate(data);
    else createMutation.mutate(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">{isEdit ? 'Edit Employee' : 'Add Employee'}</h3>
          <button type="button" onClick={close} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">First Name *</label>
              <input {...register('firstName', { required: 'First name is required' })} className={`input ${errors.firstName ? 'input-error' : ''}`} />
              {errors.firstName && <p className="error-msg">{errors.firstName.message}</p>}
            </div>
            <div>
              <label className="label">Last Name *</label>
              <input {...register('lastName', { required: 'Last name is required' })} className={`input ${errors.lastName ? 'input-error' : ''}`} />
              {errors.lastName && <p className="error-msg">{errors.lastName.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Employee ID *</label>
              <input {...register('employeeId', { required: 'Employee ID is required' })} className={`input ${errors.employeeId ? 'input-error' : ''}`} placeholder="EMP001" disabled={isEdit} />
              {errors.employeeId && <p className="error-msg">{errors.employeeId.message}</p>}
            </div>
            <div>
              <label className="label">Email *</label>
              <input {...register('email', { required: 'Email is required' })} type="email" className={`input ${errors.email ? 'input-error' : ''}`} disabled={isEdit} />
              {errors.email && <p className="error-msg">{errors.email.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Role</label>
              <select {...register('role')} className="input">
                <option value="EMPLOYEE">Employee</option>
                <option value="TEAM_LEAD">Team Lead</option>
                <option value="PROJECT_MANAGER">Project Manager</option>
                <option value="DEPARTMENT_MANAGER">Department Manager</option>
                <option value="HR_ADMIN">HR Admin</option>
                <option value="PAYROLL_ADMIN">Payroll Admin</option>
                <option value="SYSTEM_ADMIN">System Admin</option>
                <option value="EXECUTIVE">Executive</option>
              </select>
            </div>
            <div>
              <label className="label">Designation</label>
              <input {...register('designation')} className="input" placeholder="Software Engineer" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Join Date</label>
              <input {...register('joinDate')} type="date" className="input" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input {...register('phone')} type="tel" className="input" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Timezone</label>
              <input {...register('timezone')} className="input" placeholder="UTC" />
            </div>
            {isEdit && (
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input {...register('isActive')} type="checkbox" className="h-4 w-4 rounded border-gray-300 text-primary-600" />
                  <span className="label mb-0">Active</span>
                </label>
              </div>
            )}
          </div>

          {!isEdit && <p className="text-xs text-gray-500">A temporary password will be generated and shown after creation.</p>}

          <div className="flex gap-3 justify-end">
            <button type="button" onClick={close} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={isPending} className="btn-primary">
              {isPending ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Employee')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
