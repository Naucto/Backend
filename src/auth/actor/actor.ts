import { Permission, permissionsFor, RoleWithPermissions } from "@auth/permissions";

export { ROLE_ADMIN, ROLE_MODERATOR } from "@auth/permissions";

type OwnedResource = { authorId?: number | null; userId?: number | null };

export class Actor {
  readonly permissions: readonly Permission[];

  constructor(
    readonly id: number,
    readonly roles: readonly string[],
    permissions: readonly Permission[] = permissionsFor(roles.map((name) => ({ name })))
  ) {
    this.permissions = permissions;
  }

  static from(user: { id: number; roles?: readonly RoleWithPermissions[] | undefined }): Actor {
    const roles = user.roles ?? [];
    return new Actor(user.id, roles.map((role) => role.name), permissionsFor(roles));
  }

  can(permission: Permission): boolean {
    return this.permissions.includes(permission);
  }

  canAny(...permissions: Permission[]): boolean {
    return permissions.some((permission) => this.can(permission));
  }

  get isStaff(): boolean {
    return this.permissions.length > 0;
  }

  get rank(): number {
    if (this.can(Permission.MANAGE_ROLES) || this.can(Permission.MANAGE_USERS)) return 2;
    return this.isStaff ? 1 : 0;
  }

  owns(resource: OwnedResource): boolean {
    return (resource.authorId ?? resource.userId) === this.id;
  }

  canActOn(resource: OwnedResource): boolean {
    return this.owns(resource) || this.can(Permission.MODERATE_CONTENT);
  }

  actsAsModeratorOn(resource: OwnedResource): boolean {
    return !this.owns(resource) && this.can(Permission.MODERATE_CONTENT);
  }
}
