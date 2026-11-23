import { CollectionVisibility, ModerationTargetType } from '@prisma/client';

import { uuidOf } from '../../../test/uuid';
import { USER } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { ITEM_ORDER } from '../collections/collections.service';
import { ModerationTargetService } from './moderation-target.service';

describe('ModerationTargetService', () => {
  const owner = {
    id: uuidOf(7),
    username: 'louis',
    nickname: null,
    role: USER,
    email: 'louis@example.com',
    deletedAt: null,
  };

  const prisma = { collection: { findUnique: jest.fn() } };
  let service: ModerationTargetService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ModerationTargetService(prisma as unknown as PrismaService);
  });

  describe('a collection', () => {
    const collection = (overrides: object = {}): object => ({
      title: 'Couch co-op',
      description: 'Side by side.',
      visibility: CollectionVisibility.PUBLIC,
      hiddenAt: null,
      owner,
      items: [
        { project: { id: uuidOf(12), name: 'Draft name', publishedName: 'Ferry Click' } },
        { project: { id: uuidOf(13), name: 'Unreleased', publishedName: null } },
      ],
      ...overrides,
    });
    const view = (): ReturnType<ModerationTargetService['view']> =>
      service.view(ModerationTargetType.COLLECTION, uuidOf(40));

    it.each([
      ['a public one anyone reads', {}, 'VISIBLE'],
      [
        'an unlisted one whoever holds its id reads',
        { visibility: CollectionVisibility.UNLISTED },
        'VISIBLE',
      ],
      [
        'a private one its owner keeps',
        { visibility: CollectionVisibility.PRIVATE },
        'UNPUBLISHED',
      ],
      ['one moderation withholds', { hiddenAt: new Date() }, 'HIDDEN'],
      [
        'a private one moderation withholds',
        { visibility: CollectionVisibility.PRIVATE, hiddenAt: new Date() },
        'HIDDEN',
      ],
    ])('stands as %s', async (_case, state, expected) => {
      prisma.collection.findUnique.mockResolvedValue(collection(state));

      await expect(view()).resolves.toMatchObject({ state: expected });
    });

    it('reads in full whatever players see of it: its words, its owner, who may read it and its games in order', async () => {
      prisma.collection.findUnique.mockResolvedValue(
        collection({ visibility: CollectionVisibility.UNLISTED, hiddenAt: new Date() }),
      );

      await expect(view()).resolves.toEqual({
        type: ModerationTargetType.COLLECTION,
        id: uuidOf(40),
        state: 'HIDDEN',
        owner,
        content: { title: 'Couch co-op', body: 'Side by side.' },
        project: null,
        visibility: 'UNLISTED',
        games: [
          { id: uuidOf(12), name: 'Ferry Click' },
          { id: uuidOf(13), name: 'Unreleased' },
        ],
      });
      expect(prisma.collection.findUnique.mock.calls[0][0].select.items.orderBy).toBe(ITEM_ORDER);
    });

    it('is gone once its row is', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);

      await expect(view()).resolves.toEqual({
        type: ModerationTargetType.COLLECTION,
        id: uuidOf(40),
        state: 'GONE',
        owner: null,
        content: null,
        project: null,
        visibility: null,
        games: [],
      });
    });
  });
});
