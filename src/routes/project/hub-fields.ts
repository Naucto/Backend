import { Project } from '@prisma/client';

type HubSnapshot = Pick<
  Project,
  | 'name'
  | 'shortDesc'
  | 'longDesc'
  | 'tags'
  | 'publishedName'
  | 'publishedShortDesc'
  | 'publishedLongDesc'
  | 'publishedTags'
>;

/**
 * The name the hub shows: the one taken at the last release, else the draft's. An empty published
 * name counts as none.
 */
export function hubName(project: Pick<Project, 'name' | 'publishedName'>): string {
  return project.publishedName || project.name;
}

/**
 * What the hub shows of a game: the fields as of its last release, each falling back to the draft
 * where that release did not set it. An empty published tag list counts as none.
 */
export function hubFields<T extends HubSnapshot>(project: T): T {
  return {
    ...project,
    name: hubName(project),
    shortDesc: project.publishedShortDesc ?? project.shortDesc,
    longDesc: project.publishedLongDesc ?? project.longDesc,
    tags: project.publishedTags.length > 0 ? project.publishedTags : project.tags,
  };
}
