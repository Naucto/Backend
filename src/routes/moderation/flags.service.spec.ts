import { ModerationReason, ModerationTargetType, Prisma } from '@prisma/client';

import { uuidOf } from '../../../test/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { FlagNotifier } from './flag-notifier';
import { FlagsService } from './flags.service';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationTargetService, TargetView } from './moderation-target.service';

const REPORT = {
  targetType: ModerationTargetType.COMMENT,
  targetId: uuidOf(31),
  reason: ModerationReason.SPAM,
};

describe('FlagsService', () => {
  const view = (overrides: Partial<TargetView> = {}): TargetView => ({
    type: ModerationTargetType.COMMENT,
    id: uuidOf(31),
    state: 'VISIBLE',
    owner: {
      id: uuidOf(7),
      username: 'louis',
      nickname: null,
      role: 'whatever',
      email: 'louis@example.com',
      deletedAt: null,
    },
    content: { title: null, body: 'Buy my thing' },
    project: { id: uuidOf(12), name: 'Ferry Click', reachable: true },
    visibility: null,
    games: [],
    ...overrides,
  });

  const prisma = { flag: { create: jest.fn(), count: jest.fn() } };
  const targets = { view: jest.fn() };
  const notifier = { caseOpened: jest.fn() };
  let service: FlagsService;

  beforeEach(() => {
    jest.resetAllMocks();
    targets.view.mockResolvedValue(view());
    prisma.flag.create.mockResolvedValue({ id: uuidOf(50) });
    prisma.flag.count.mockResolvedValue(1);
    service = new FlagsService(
      prisma as unknown as PrismaService,
      targets as unknown as ModerationTargetService,
      notifier as unknown as FlagNotifier,
    );
    jest.spyOn(service['logger'], 'warn').mockImplementation();
  });

  it('keeps the target as it read, whose it is, and one open flag per reporter', async () => {
    await expect(service.create(uuidOf(3), { ...REPORT, details: 'Third time' })).resolves.toEqual({
      id: uuidOf(50),
    });

    expect(prisma.flag.create).toHaveBeenCalledWith({
      data: {
        reporterId: uuidOf(3),
        targetType: ModerationTargetType.COMMENT,
        targetId: uuidOf(31),
        targetOwnerId: uuidOf(7),
        reason: ModerationReason.SPAM,
        details: 'Third time',
        snapshot: { title: null, body: 'Buy my thing' },
        openKey: `${uuidOf(3)}:COMMENT:${uuidOf(31)}`,
      },
      select: { id: true },
    });
  });

  it('refuses a report on your own content', async () => {
    await expect(service.create(uuidOf(7), REPORT)).rejects.toMatchObject({
      code: MODERATION_ERROR.CANNOT_FLAG_OWN_CONTENT,
    });
    expect(prisma.flag.create).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<TargetView>]>([
    ['is gone', { state: 'GONE', owner: null, content: null, project: null }],
    ['moderation already hid', { state: 'HIDDEN' }],
    ['a user deleted', { state: 'DELETED' }],
    [
      'sits on a game players cannot reach',
      { project: { id: uuidOf(12), name: 'Draft', reachable: false } },
    ],
  ])('finds nothing to report in a comment that %s', async (_case, state) => {
    targets.view.mockResolvedValue(view(state));

    await expect(service.create(uuidOf(3), REPORT)).rejects.toMatchObject({
      code: MODERATION_ERROR.FLAG_TARGET_NOT_FOUND,
    });
    expect(prisma.flag.create).not.toHaveBeenCalled();
  });

  describe('a collection', () => {
    const LIST = {
      targetType: ModerationTargetType.COLLECTION,
      targetId: uuidOf(40),
      reason: ModerationReason.HATE,
    };
    const list = (overrides: Partial<TargetView> = {}): TargetView =>
      view({
        type: ModerationTargetType.COLLECTION,
        id: uuidOf(40),
        content: { title: 'Couch co-op', body: 'Side by side.' },
        project: null,
        visibility: 'PUBLIC',
        games: [{ id: uuidOf(12), name: 'Ferry Click' }],
        ...overrides,
      });

    it.each(['PUBLIC', 'UNLISTED'] as const)(
      'is reported by whoever reads a %s one, with its title and description as they read',
      async (visibility) => {
        targets.view.mockResolvedValue(list({ visibility }));

        await expect(service.create(uuidOf(3), LIST)).resolves.toEqual({ id: uuidOf(50) });

        expect(prisma.flag.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              targetType: ModerationTargetType.COLLECTION,
              targetId: uuidOf(40),
              targetOwnerId: uuidOf(7),
              snapshot: { title: 'Couch co-op', body: 'Side by side.' },
              openKey: `${uuidOf(3)}:COLLECTION:${uuidOf(40)}`,
            }),
          }),
        );
      },
    );

    it.each<[string, Partial<TargetView>]>([
      ['its owner keeps private', { state: 'UNPUBLISHED', visibility: 'PRIVATE' }],
      ['moderation already hid', { state: 'HIDDEN' }],
      ['is gone', { state: 'GONE', owner: null, content: null, visibility: null, games: [] }],
    ])('answers as nothing at all when it is one %s', async (_case, state) => {
      targets.view.mockResolvedValue(list(state));

      await expect(service.create(uuidOf(3), LIST)).rejects.toMatchObject({
        code: MODERATION_ERROR.FLAG_TARGET_NOT_FOUND,
      });
      expect(prisma.flag.create).not.toHaveBeenCalled();
    });

    it('is not reported by its owner', async () => {
      targets.view.mockResolvedValue(list());

      await expect(service.create(uuidOf(7), LIST)).rejects.toMatchObject({
        code: MODERATION_ERROR.CANNOT_FLAG_OWN_CONTENT,
      });
      expect(prisma.flag.create).not.toHaveBeenCalled();
    });
  });

  it('still takes a report on a suspended account, whose profile stays up', async () => {
    targets.view.mockResolvedValue(
      view({ type: ModerationTargetType.USER, id: uuidOf(7), state: 'SUSPENDED', project: null }),
    );

    await expect(
      service.create(uuidOf(3), {
        ...REPORT,
        targetType: ModerationTargetType.USER,
        targetId: uuidOf(7),
      }),
    ).resolves.toEqual({ id: uuidOf(50) });
  });

  it('says so when the reporter already has a report open on it', async () => {
    prisma.flag.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );

    await expect(service.create(uuidOf(3), REPORT)).rejects.toMatchObject({
      code: MODERATION_ERROR.ALREADY_FLAGGED,
    });
    expect(notifier.caseOpened).not.toHaveBeenCalled();
  });

  it('tells staff when a case opens', async () => {
    await service.create(uuidOf(3), REPORT);

    expect(notifier.caseOpened).toHaveBeenCalledWith(expect.objectContaining(REPORT));
  });

  it('does not tell them again for each further report on the same target', async () => {
    prisma.flag.count.mockResolvedValue(2);

    await service.create(uuidOf(3), REPORT);

    expect(notifier.caseOpened).not.toHaveBeenCalled();
  });

  it('keeps the report when staff could not be told', async () => {
    notifier.caseOpened.mockRejectedValue(new Error('discord is down'));

    await expect(service.create(uuidOf(3), REPORT)).resolves.toEqual({ id: uuidOf(50) });
  });
});
