/**
 * Gives a local hub collections to show: public ones by several of the seeded people, large enough
 * for the hub to put forward, one too small for it, and an unlisted and a private one to check
 * who reads what. Each takes its games from the published ones by a seeded draw, so two runs
 * over the same games write the same thing. Re-running it rewrites what it wrote. Run by
 * `seed:dev`, before the hub signals, which have the hub of the day drawn again.
 */
import { CollectionVisibility, PrismaClient } from '@prisma/client';

import { PUBLISHED } from '../src/routes/project/project-select';
import { draw } from '../src/routes/recommendations/hub-scoring';

interface SeedCollection {
  owner: string;
  title: string;
  description?: string;
  visibility: CollectionVisibility;
  games: number;
}

/** The place in this list is what identifies a seeded collection: add at the end. */
export const SEED_COLLECTIONS: SeedCollection[] = [
  {
    owner: 'alexis',
    title: 'Couch co-op',
    description: 'Games to play side by side.',
    visibility: 'PUBLIC',
    games: 4,
  },
  {
    owner: 'louis',
    title: 'Five-minute breaks',
    description: 'One run, then back to work. In theory.',
    visibility: 'PUBLIC',
    games: 5,
  },
  { owner: 'thea', title: 'Made me rage', visibility: 'PUBLIC', games: 3 },
  {
    owner: 'ulysse',
    title: 'Pixel perfect',
    description: 'Every sprite in its place.',
    visibility: 'PUBLIC',
    games: 6,
  },
  // A second public one of the same owner: the hub shows one of the two, not always the same.
  { owner: 'alexis', title: 'Weekend picks', visibility: 'PUBLIC', games: 5 },
  // Public but under three games: on the public list, never on the hub.
  { owner: 'edgar', title: 'Two is a start', visibility: 'PUBLIC', games: 2 },
  {
    owner: 'alexis',
    title: 'Jam shortlist',
    description: 'For whoever has the link.',
    visibility: 'UNLISTED',
    games: 3,
  },
  { owner: 'alexis', title: 'To finish one day', visibility: 'PRIVATE', games: 4 },
];

/** The id a seeded collection keeps from one run to the next. */
export const seedCollectionId = (index: number): string =>
  `c011ec7e-5eed-4000-8000-${index.toString(16).padStart(12, '0')}`;

/** Writes the collections and answers what it wrote, in one line. */
export async function seedCollections(
  prisma: PrismaClient,
  people: Map<string, string>,
): Promise<string> {
  const published = await prisma.project.findMany({
    where: PUBLISHED,
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (published.length === 0) {
    return 'no published game yet, so nothing to collect — run seed:content, then this again';
  }

  let written = 0;
  for (const [index, collection] of SEED_COLLECTIONS.entries()) {
    const ownerId = people.get(collection.owner);
    if (ownerId === undefined) {
      continue;
    }

    const id = seedCollectionId(index);
    const row = {
      ownerId,
      title: collection.title,
      description: collection.description ?? null,
      visibility: collection.visibility,
    };
    await prisma.collection.upsert({ where: { id }, update: row, create: { id, ...row } });

    const picked = published
      .map((game) => ({ id: game.id, drawn: draw('seed-dev-collections', `${index}:${game.id}`) }))
      .sort((a, b) => a.drawn - b.drawn)
      .slice(0, collection.games);
    await prisma.collectionItem.deleteMany({ where: { collectionId: id } });
    await prisma.collectionItem.createMany({
      data: picked.map((game, position) => ({ collectionId: id, projectId: game.id, position })),
    });
    written++;
  }

  return `${String(written)} collections over ${String(published.length)} published games`;
}
