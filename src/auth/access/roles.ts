/** Each value is stored as it stands in the `User.role` column. */
export const USER = 'User';
export const MODERATOR = 'Moderator';
export const ADMIN = 'Admin';

export type RoleName = typeof USER | typeof MODERATOR | typeof ADMIN;

/** A role is held by anyone holding a role of equal or higher rank: an admin is also a moderator. */
const RANK: Record<RoleName, number> = {
  [USER]: 0,
  [MODERATOR]: 1,
  [ADMIN]: 2,
};

export const ROLE_NAMES: readonly RoleName[] = [USER, MODERATOR, ADMIN];

/** Reads a stored role; a value the hierarchy does not know grants the least privilege. */
export function parseRole(value: string): RoleName {
  return ROLE_NAMES.find((role) => role === value) ?? USER;
}

export function holdsRole(userRole: RoleName, required: RoleName): boolean {
  return RANK[userRole] >= RANK[required];
}
