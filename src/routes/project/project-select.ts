import { Prisma, Project } from '@prisma/client';

import { DiskStyleDto } from './dto/disk-style.dto';

// What a project says about its people, on public routes as well as private ones: the id
// and the name, never the address behind the account.
export const CREATOR_SELECT = {
  id: true,
  username: true,
};

export const COLLABORATOR_SELECT = {
  id: true,
  username: true,
};

export const WITH_PEOPLE = {
  collaborators: { select: COLLABORATOR_SELECT },
  creator: { select: CREATOR_SELECT },
} satisfies Prisma.ProjectInclude;

/** A comment still standing: neither deleted by its author nor hidden by moderation. */
export const LIVE_COMMENT = { deleted: false, hiddenAt: null } satisfies Prisma.CommentWhereInput;

/** The same test for a raw query, as a condition on "Comment". */
export const LIVE_COMMENT_SQL = Prisma.sql`NOT "Comment"."deleted" AND "Comment"."hiddenAt" IS NULL`;

export const WITH_PEOPLE_AND_COUNTS = {
  ...WITH_PEOPLE,
  _count: {
    select: { forks: true, comments: { where: LIVE_COMMENT } },
  },
} satisfies Prisma.ProjectInclude;

// Holds a release, whether or not anyone can reach it: set only once the release blob is in place.
// `status` is what the author calls the game and plays no part.
export const RELEASED: Prisma.ProjectWhereInput = { publishedAt: { not: null } };

// The one test for "on the hub": released, and not withheld by moderation. Its owner still counts
// a hidden game among the released ones, which is what `RELEASED` is for.
export const PUBLISHED: Prisma.ProjectWhereInput = { ...RELEASED, hiddenAt: null };

/** The same test for a raw query, as a condition on "Project". */
export const PUBLISHED_SQL = Prisma.sql`"Project"."publishedAt" IS NOT NULL AND "Project"."hiddenAt" IS NULL`;

/**
 * A project row is answered as it stands, so the number it had while ids were integers is left in
 * the database by every query that reads a whole row. Only the translation of an old link reads it.
 */
export const WITHOUT_LEGACY_ID = { legacyId: true } satisfies Prisma.ProjectOmit;

export type ProjectRow = Omit<Project, 'legacyId'>;

export const DEFAULT_LIMIT = 24;

export type ProjectEx = ProjectRow & {
  collaborators: Array<{ id: string; username: string }>;
  creator: { id: string; username: string };
};

export type ProjectWithCounts = ProjectEx & {
  _count: {
    comments: number;
    forks: number;
  };
};

/** What an answer adds to a project row for whoever draws the game. */
export type ProjectLook = {
  coverUrl: string | null;
  clipUrl: string | null;
  disk: DiskStyleDto | null;
};

export type ReleaseProject = ProjectEx &
  ProjectLook & {
    commentCount: number;
    forkCount: number;
  };

export type PaginatedProjectsResult<T> = {
  projects: T[];
  total: number;
  page: number;
  limit: number;
};
