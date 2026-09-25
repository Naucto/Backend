import { ModerationTargetType } from "@prisma/client";

/**
 * A reference to something moderation can act on.
 *
 * The audit log is keyed by this rather than by a per-entity table, so asking
 * "what happened to this thing?" is one call whatever the thing is -- and
 * adding a new moderatable entity does not mean adding another log table,
 * another set of `hidden*` columns and another set of admin routes.
 */
export interface ModeratableRef {
  readonly type: ModerationTargetType;
  readonly id: number;
}

/** Anything with a numeric id can be referenced; these keep call sites honest. */
export const projectRef = (project: { id: number } | number): ModeratableRef => ({
  type: ModerationTargetType.PROJECT,
  id: typeof project === "number" ? project : project.id
});

export const commentRef = (comment: { id: number } | number): ModeratableRef => ({
  type: ModerationTargetType.COMMENT,
  id: typeof comment === "number" ? comment : comment.id
});

export const userRef = (user: { id: number } | number): ModeratableRef => ({
  type: ModerationTargetType.USER,
  id: typeof user === "number" ? user : user.id
});

export const refKey = (ref: ModeratableRef): string => `${ref.type}:${ref.id}`;
