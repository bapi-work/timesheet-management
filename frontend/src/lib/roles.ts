export const ADMIN_ROLES = ['SYSTEM_ADMIN', 'HR_ADMIN'] as const;

export const MANAGEMENT_ROLES = [
  'SYSTEM_ADMIN',
  'HR_ADMIN',
  'DEPARTMENT_MANAGER',
  'PROJECT_MANAGER',
  'TEAM_LEAD',
] as const;

export const ANALYTICS_ROLES = [...MANAGEMENT_ROLES, 'EXECUTIVE'] as const;

export const PAYROLL_ROLES = [...ADMIN_ROLES, 'PAYROLL_ADMIN'] as const;

export function hasRole(role: string | null | undefined, roles: readonly string[]): boolean {
  return !!role && roles.includes(role);
}
