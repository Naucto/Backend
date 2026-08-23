import { RoleDto } from "@auth/dto/role.dto";

export const ROLE_ADMIN = "Admin";
export const ROLE_MODERATOR = "Moderator";

/** What a caller may do to a resource they do not own. */
export type ModerationPower = "edit" | "delete" | "hide";

/**
 * The authenticated caller, with their roles resolved.
 *
 * Exists so authorisation can be asked as a question inside a service
 * (`actor.canModerate()`) as well as declared on a controller (`@Roles`).
 * Without it, "may this caller touch someone else's comment?" has to be
 * re-derived from raw role strings at every call site.
 */
export class Actor {
  constructor(
    readonly id: number,
    readonly roles: readonly string[]
  ) {}

  static from(user: {
    id: number;
    roles?: RoleDto[] | { name: string }[] | undefined;
  }): Actor {
    return new Actor(user.id, (user.roles ?? []).map((role) => role.name));
  }

  get isAdmin(): boolean {
    return this.roles.includes(ROLE_ADMIN);
  }

  /** Admin implies moderator: an admin can do everything a moderator can. */
  get isModerator(): boolean {
    return this.isAdmin || this.roles.includes(ROLE_MODERATOR);
  }

  get isStaff(): boolean {
    return this.isModerator;
  }

  owns(resource: { authorId?: number | null; userId?: number | null }): boolean {
    const ownerId = resource.authorId ?? resource.userId ?? null;

    return ownerId !== null && ownerId === this.id;
  }

  /**
   * Whether this actor may act on a resource they do not necessarily own.
   *
   * This is the whole point of the role system: a moderator edits or removes
   * someone else's content through the ordinary route, rather than through a
   * parallel set of admin endpoints.
   */
  canActOn(resource: {
    authorId?: number | null;
    userId?: number | null;
  }): boolean {
    return this.owns(resource) || this.isModerator;
  }

  /** True when the actor is acting on content that is not theirs. */
  actsAsModeratorOn(resource: {
    authorId?: number | null;
    userId?: number | null;
  }): boolean {
    return !this.owns(resource) && this.isModerator;
  }
}
