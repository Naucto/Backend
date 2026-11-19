/** Each value is stored as it stands in the `User.role` column. */
export const USER = 'User';
export const VIEWER = 'Viewer';
export const MODERATOR = 'Moderator';
export const ADMIN = 'Admin';

export type RoleName = typeof USER | typeof VIEWER | typeof MODERATOR | typeof ADMIN;

/**
 * A role is held by anyone holding a role of equal or higher rank: an admin is also a moderator.
 *
 * A viewer is the one role whose reach is not its rank. It observes: it reads the whole admin
 * console, which a moderator does not, and changes nothing anywhere. That reach is granted by the
 * access guard to this role by name, so ranking above a viewer does not carry it.
 */
const RANK: Record<RoleName, number> = {
  [USER]: 0,
  [VIEWER]: 1,
  [MODERATOR]: 2,
  [ADMIN]: 3,
};

export const ROLE_NAMES: readonly RoleName[] = [USER, VIEWER, MODERATOR, ADMIN];

/** The roles that sign in to the admin console. */
export const STAFF_ROLE_NAMES: readonly RoleName[] = ROLE_NAMES.filter((role) => role !== USER);

/** Reads a stored role; a value the hierarchy does not know grants the least privilege. */
export function parseRole(value: string): RoleName {
  return ROLE_NAMES.find((role) => role === value) ?? USER;
}

export function holdsRole(userRole: RoleName, required: RoleName): boolean {
  return RANK[userRole] >= RANK[required];
}

/** Whether a role reads the email addresses of accounts. Observing and moderating need neither. */
export function readsAddresses(role: RoleName): boolean {
  return holdsRole(role, ADMIN);
}

/** Whether `actor` ranks strictly above `target`: staff act only on accounts below their own role. */
export function outranks(actor: RoleName, target: RoleName): boolean {
  return RANK[actor] > RANK[target];
}
