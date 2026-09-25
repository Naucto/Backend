/**
 * The roles that grant access to the admin panel.
 *
 * Shared so the login check, the route guards and the grant/revoke endpoints
 * cannot drift on what counts as staff.
 */
export const STAFF_ROLES = ["Admin", "Moderator"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}
