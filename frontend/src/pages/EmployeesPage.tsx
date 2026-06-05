import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { MagnifyingGlassIcon, UserPlusIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../store/auth.store';
import { ADMIN_ROLES, hasRole } from '../lib/roles';
import EmployeeFormModal from '../components/EmployeeFormModal';

const ROLE_BADGE: Record<string, string> = {
  EMPLOYEE: 'badge-gray',
  TEAM_LEAD: 'badge-blue',
  PROJECT_MANAGER: 'badge-purple',
  DEPARTMENT_MANAGER: 'badge-purple',
  HR_ADMIN: 'badge-yellow',
  PAYROLL_ADMIN: 'badge-yellow',
  SYSTEM_ADMIN: 'badge-red',
  EXECUTIVE: 'badge-green',
};

export default function EmployeesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const [showUserModal, setShowUserModal] = useState(false);
  const user = useAuthStore(s => s.user);
  const isAdmin = hasRole(user?.role, ADMIN_ROLES);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', page, search, role],
    queryFn: () => api.get(`/users?page=${page}&limit=20&search=${search}&role=${role}`).then(r => r.data),
  });

  const handleExport = async () => {
    const r = await api.get('/admin/export-employees', { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a'); a.href = url; a.download = 'employees.xlsx'; a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500 text-sm">{data?.total || 0} total employees</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={handleExport} className="btn-secondary btn-sm">
              <ArrowDownTrayIcon className="h-4 w-4" /> Export
            </button>
            <button onClick={() => setShowUserModal(true)} className="btn-primary btn-sm">
              <UserPlusIcon className="h-4 w-4" /> Add Employee
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input pl-9" placeholder="Search by name, email, ID..." />
        </div>
        <select value={role} onChange={e => { setRole(e.target.value); setPage(1); }} className="input w-auto">
          <option value="">All Roles</option>
          <option value="EMPLOYEE">Employee</option>
          <option value="TEAM_LEAD">Team Lead</option>
          <option value="PROJECT_MANAGER">Project Manager</option>
          <option value="DEPARTMENT_MANAGER">Dept Manager</option>
          <option value="HR_ADMIN">HR Admin</option>
          <option value="SYSTEM_ADMIN">System Admin</option>
        </select>
      </div>

      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Employee</th>
              <th className="th">ID</th>
              <th className="th">Department</th>
              <th className="th">Role</th>
              <th className="th">Manager</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <tr><td colSpan={7} className="td text-center py-12"><div className="h-6 w-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
            ) : (data?.users || []).map((user: Record<string, unknown>) => (
              <tr key={user.id as string} className="tr-hover">
                <td className="td">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700">
                      {(user.firstName as string)?.[0]}{(user.lastName as string)?.[0]}
                    </div>
                    <div>
                      <p className="font-medium">{user.firstName as string} {user.lastName as string}</p>
                      <p className="text-xs text-gray-500">{user.email as string}</p>
                    </div>
                  </div>
                </td>
                <td className="td text-gray-500">{user.employeeId as string}</td>
                <td className="td">{(user.department as { name: string })?.name || '—'}</td>
                <td className="td">
                  <span className={ROLE_BADGE[user.role as string] || 'badge-gray'}>{(user.role as string)?.replace(/_/g, ' ')}</span>
                </td>
                <td className="td text-gray-500">
                  {user.manager ? `${(user.manager as { firstName: string }).firstName} ${(user.manager as { lastName: string }).lastName}` : '—'}
                </td>
                <td className="td">
                  <span className={user.isActive ? 'badge-green' : 'badge-red'}>{user.isActive ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="td">
                  <Link to={`/employees/${user.id}`} className="text-primary-600 hover:underline text-sm">View</Link>
                </td>
              </tr>
            ))}
            {!isLoading && !data?.users?.length && (
              <tr><td colSpan={7} className="td text-center text-gray-400 py-12">No employees found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data?.total > 20 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, data.total)} of {data.total}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => p - 1)} disabled={page === 1} className="btn-secondary btn-sm">Previous</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total} className="btn-secondary btn-sm">Next</button>
          </div>
        </div>
      )}

      {showUserModal && <EmployeeFormModal onClose={() => setShowUserModal(false)} />}
    </div>
  );
}
