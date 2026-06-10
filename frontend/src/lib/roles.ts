// SYSTEM_ADMIN only — system config, backup, security resets
export const SYSTEM_ADMIN_ROLES = ['SYSTEM_ADMIN'] as const;

// HR-level — people management, departments, holidays, audit logs
export const ADMIN_ROLES = ['SYSTEM_ADMIN', 'HR_ADMIN'] as const;

// Management — timesheets, projects, clients, teams
export const MANAGEMENT_ROLES = [
  'SYSTEM_ADMIN',
  'HR_ADMIN',
  'DEPARTMENT_MANAGER',
  'PROJECT_MANAGER',
  'TEAM_LEAD',
] as const;

// Payroll processing — SYSTEM_ADMIN + dedicated PAYROLL_ADMIN only
export const PAYROLL_ROLES = ['SYSTEM_ADMIN', 'PAYROLL_ADMIN'] as const;

// Analytics/reports — managers + executives + payroll
export const ANALYTICS_ROLES = [...MANAGEMENT_ROLES, 'EXECUTIVE', 'PAYROLL_ADMIN'] as const;

export function hasRole(role: string | null | undefined, roles: readonly string[]): boolean {
  return !!role && roles.includes(role);
}
