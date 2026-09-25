export enum Permission {
  MODERATE_CONTENT = "MODERATE_CONTENT",
  MODERATE_USERS = "MODERATE_USERS",
  MANAGE_REPORTS = "MANAGE_REPORTS",
  VIEW_AUDIT = "VIEW_AUDIT",
  VIEW_ACTIVITY = "VIEW_ACTIVITY",
  VIEW_INSIGHTS = "VIEW_INSIGHTS",
  MANAGE_USERS = "MANAGE_USERS",
  MANAGE_ROLES = "MANAGE_ROLES"
}

export const ROLE_ADMIN = "Admin";
export const ROLE_MODERATOR = "Moderator";

const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  [ROLE_ADMIN]: Object.values(Permission),
  [ROLE_MODERATOR]: [
    Permission.MODERATE_CONTENT,
    Permission.MODERATE_USERS,
    Permission.MANAGE_REPORTS,
    Permission.VIEW_AUDIT,
    Permission.VIEW_ACTIVITY
  ]
};

export interface RoleWithPermissions {
  name: string;
  permissions?: readonly string[];
}

export function permissionsFor(roles: readonly RoleWithPermissions[]): Permission[] {
  const granted = new Set(roles.flatMap((role) => [
    ...(Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role.name) ? ROLE_PERMISSIONS[role.name] ?? [] : []),
    ...(role.permissions ?? [])
  ]));
  return Object.values(Permission).filter((permission) => granted.has(permission));
}
