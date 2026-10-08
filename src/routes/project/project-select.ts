import { Prisma, Project } from '@prisma/client';

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

export const WITH_PEOPLE_AND_COUNTS = {
  ...WITH_PEOPLE,
  _count: {
    select: { forks: true, comments: { where: { deleted: false } } },
  },
} satisfies Prisma.ProjectInclude;

// The one test for "on the hub". `status` is what the author calls the game; this is what the
// hub does with it, and it is set only once the release blob is in place.
export const PUBLISHED: Prisma.ProjectWhereInput = { publishedAt: { not: null } };

export const DEFAULT_LIMIT = 24;

export type ProjectEx = Project & {
  collaborators: Array<{ id: number; username: string }>;
  creator: { id: number; username: string };
};

type ProjectWithCounts = ProjectEx & {
  _count: {
    comments: number;
    forks: number;
  };
};

export type ReleaseProject = ProjectEx & {
  commentCount: number;
  forkCount: number;
};

export type PaginatedProjectsResult<T> = {
  projects: T[];
  total: number;
  page: number;
  limit: number;
};

export function withCounts(project: ProjectWithCounts): ReleaseProject {
  const { _count, ...rest } = project;
  return {
    ...rest,
    commentCount: _count.comments,
    forkCount: _count.forks,
  };
}
