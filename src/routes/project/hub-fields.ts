import { Project } from '@prisma/client';

import { HubGameDto } from './dto/hub-game.dto';
import { ReleaseProject } from './project-select';

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

/** The tags the hub files a game under: the released ones, else the draft's. */
export function hubTags(project: Pick<Project, 'tags' | 'publishedTags'>): string[] {
  return project.publishedTags.length > 0 ? project.publishedTags : project.tags;
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
    tags: hubTags(project),
  };
}

/**
 * The card of a game, field by field: a release row also carries what only its authors may read
 * (content size, release hash and revision), and a spread would hand that out.
 */
export function toHubGame(release: ReleaseProject): HubGameDto {
  return {
    id: release.id,
    name: release.name,
    shortDesc: release.shortDesc,
    longDesc: release.longDesc,
    tags: release.tags,
    iconUrl: release.iconUrl,
    coverUrl: release.coverUrl,
    status: release.status,
    monetization: release.monetization,
    price: release.price,
    userId: release.userId,
    createdAt: release.createdAt,
    updatedAt: release.updatedAt,
    publishedAt: release.publishedAt,
    viewCount: release.viewCount,
    uniquePlayers: release.uniquePlayers,
    likes: release.likes,
    commentCount: release.commentCount,
    forkCount: release.forkCount,
    forkedFromId: release.forkedFromId,
    collaborators: release.collaborators,
    creator: release.creator,
  };
}
