export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Team {
  _id: string;
  _creationTime: number;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  role?: TeamRole;
}

export interface TeamMember {
  _id: string;
  _creationTime: number;
  teamId: string;
  userId: string;
  role: TeamRole;
  joinedAt: number;
  invitedBy?: string;
  user?: {
    email: string;
    name?: string;
  };
}

export interface TeamInvitation {
  _id: string;
  _creationTime: number;
  teamId: string;
  email: string;
  role: Exclude<TeamRole, 'owner'>;
  invitedBy: string;
  invitedAt: number;
  expiresAt: number;
  token: string;
  status: 'pending' | 'accepted' | 'expired';
  teamName?: string;
}

export const ROLE_PERMISSIONS = {
  owner: ['read', 'write', 'delete', 'manage_members', 'manage_settings', 'billing'],
  admin: ['read', 'write', 'delete', 'manage_members', 'manage_settings'],
  member: ['read', 'write', 'delete_own'],
  viewer: ['read'],
} as const;

export type Permission = typeof ROLE_PERMISSIONS[TeamRole][number];

export function hasPermission(role: TeamRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission as any) ?? false;
}

export function canManageMembers(role: TeamRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canDeleteTeam(role: TeamRole): boolean {
  return role === 'owner';
}

export function canEditTeam(role: TeamRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canInviteMembers(role: TeamRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canRemoveMembers(role: TeamRole, targetRole: TeamRole, isSelf: boolean): boolean {
  if (isSelf) return true;
  if (role === 'owner') return targetRole !== 'owner';
  if (role === 'admin') return targetRole !== 'owner' && targetRole !== 'admin';
  return false;
}

export function canUpdateRole(userRole: TeamRole, targetRole: TeamRole, newRole: TeamRole): boolean {
  if (userRole === 'owner') {
    if (targetRole === 'owner' && newRole !== 'owner') return false;
    return true;
  }
  if (userRole === 'admin') {
    if (targetRole === 'owner') return false;
    if (newRole === 'owner') return false;
    return true;
  }
  return false;
}
