import { NotFoundException } from '@nestjs/common';
import { ModerationActionType } from '@prisma/client';
import { Readable } from 'stream';

import { aProject } from '../../../test/project-mocks';
import { uuidOf } from '../../../test/uuid';
import { MODERATOR } from '../../auth/access/roles';
import { ProjectService } from '../project/project.service';
import { ProjectContentService } from '../project/project-content.service';
import { ModerationLogService } from './moderation-log.service';
import { StaffPreviewService } from './staff-preview.service';

const MOD = { id: uuidOf(1), role: MODERATOR } as const;
const NOW = new Date('2026-11-19T12:30:00.000Z');

describe('StaffPreviewService', () => {
  const draft = aProject({
    id: uuidOf(12),
    userId: uuidOf(7),
    name: 'Secret game',
    publishedAt: null,
  });
  const file = { body: Readable.from('x'), contentLength: 1 };

  const projects = { findOne: jest.fn() };
  const content = { fetchLastVersion: jest.fn(), fetchReleaseForReview: jest.fn() };
  const log = { recordOnce: jest.fn() };
  let service: StaffPreviewService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers({ now: NOW });
    projects.findOne.mockResolvedValue(draft);
    content.fetchLastVersion.mockResolvedValue(file);
    service = new StaffPreviewService(
      projects as unknown as ProjectService,
      content as unknown as ProjectContentService,
      log as unknown as ModerationLogService,
    );
    jest.spyOn(service['logger'], 'error').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives an unpublished game as its collaborators read it', async () => {
    await expect(service.preview(MOD, uuidOf(12))).resolves.toMatchObject({
      id: uuidOf(12),
      name: 'Secret game',
      publishedAt: null,
      hasRelease: false,
    });
  });

  it('says a released game has a build to look at, hidden or not', async () => {
    projects.findOne.mockResolvedValue(
      aProject({ id: uuidOf(12), publishedAt: new Date(), hiddenAt: new Date() }),
    );

    await expect(service.preview(MOD, uuidOf(12))).resolves.toMatchObject({ hasRelease: true });
  });

  it('notes who looked at whose game, once an hour', async () => {
    await service.preview(MOD, uuidOf(12));

    const hour = Math.floor(NOW.getTime() / 3_600_000);
    expect(log.recordOnce).toHaveBeenCalledWith(
      {
        action: ModerationActionType.DRAFT_VIEWED,
        actorId: MOD.id,
        targetType: 'PROJECT',
        targetId: uuidOf(12),
        subjectUserId: uuidOf(7),
        snapshot: { title: 'Secret game', body: null },
      },
      `view:${uuidOf(1)}:${uuidOf(12)}:${String(hour)}`,
    );
  });

  it('notes the look under the same key for the game and for its content', async () => {
    await service.preview(MOD, uuidOf(12));
    await service.content(MOD, uuidOf(12), 'draft');

    const [first, second] = log.recordOnce.mock.calls;
    expect(first?.[1]).toBe(second?.[1]);
  });

  it('still shows the game when the look could not be noted', async () => {
    log.recordOnce.mockRejectedValue(new Error('database is down'));

    await expect(service.preview(MOD, uuidOf(12))).resolves.toMatchObject({ id: uuidOf(12) });
  });

  it('finds no game that does not exist, and notes nothing', async () => {
    projects.findOne.mockRejectedValue(new NotFoundException());

    await expect(service.content(MOD, uuidOf(99), 'draft')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(log.recordOnce).not.toHaveBeenCalled();
  });

  describe('content', () => {
    it('serves the latest save', async () => {
      await expect(service.content(MOD, uuidOf(12), 'draft')).resolves.toBe(file);
      expect(content.fetchReleaseForReview).not.toHaveBeenCalled();
    });

    it('has nothing to serve of a game never saved', async () => {
      content.fetchLastVersion.mockResolvedValue({ body: Readable.from([]), contentLength: 0 });

      await expect(service.content(MOD, uuidOf(12), 'draft')).resolves.toBeNull();
    });

    it('serves the released build when asked, wherever it sits', async () => {
      content.fetchReleaseForReview.mockResolvedValue(file);

      await expect(service.content(MOD, uuidOf(12), 'release')).resolves.toBe(file);
      expect(content.fetchLastVersion).not.toHaveBeenCalled();
    });
  });
});
