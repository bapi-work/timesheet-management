import prisma from './prisma';

const ORG_WIDE_ROLES = ['SYSTEM_ADMIN', 'HR_ADMIN'];

export function isOrgWideReviewer(viewer: Express.User): boolean {
  return ORG_WIDE_ROLES.includes(viewer.role);
}

/**
 * Users whose timesheets, leave and expenses this viewer may review. null means the
 * whole organization. The viewer is never included: nobody reviews their own requests.
 */
export async function getReviewableUserIds(viewer: Express.User): Promise<string[] | null> {
  if (isOrgWideReviewer(viewer)) return null;

  const scopes: Record<string, unknown>[] = [
    { managerId: viewer.userId },
    { teamMemberships: { some: { team: { leadId: viewer.userId } } } },
  ];

  if (viewer.role === 'DEPARTMENT_MANAGER') {
    const self = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { departmentId: true } });
    scopes.push({ department: { managerId: viewer.userId } });
    if (self?.departmentId) scopes.push({ departmentId: self.departmentId });
  }
  if (viewer.role === 'PROJECT_MANAGER') {
    scopes.push({ projectAssignments: { some: { project: { managerId: viewer.userId } } } });
  }

  const users = await prisma.user.findMany({
    where: { organizationId: viewer.organizationId, id: { not: viewer.userId }, OR: scopes },
    select: { id: true },
  });
  return users.map(u => u.id);
}

export async function canReviewUser(viewer: Express.User, targetUserId: string): Promise<boolean> {
  if (targetUserId === viewer.userId) return false;
  const reviewable = await getReviewableUserIds(viewer);
  if (reviewable) return reviewable.includes(targetUserId);
  const target = await prisma.user.findFirst({
    where: { id: targetUserId, organizationId: viewer.organizationId },
    select: { id: true },
  });
  return !!target;
}
