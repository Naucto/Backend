import { Readable } from 'node:stream';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { uuidOf } from '../../../test/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { PROJECT_BLOB_MAX_BYTES } from '../project/content-size';
import { ProjectContentService } from '../project/project-content.service';
import { AiService } from './ai.service';
import { AiWorkspaceService } from './ai-workspace.service';

const PROJECT = uuidOf(5);
const USER = uuidOf(1);
const b64 = (text: string): string => Buffer.from(text).toString('base64');

describe('AiWorkspaceService', () => {
  const tx = {
    aiWorkspace: { updateMany: jest.fn() },
    project: { updateMany: jest.fn() },
  };
  const prisma = {
    aiWorkspace: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const ai = { authorize: jest.fn() };
  const content = { fetchLastVersion: jest.fn() };
  const service = new AiWorkspaceService(
    prisma as unknown as PrismaService,
    ai as unknown as AiService,
    content as unknown as ProjectContentService,
  );
  const held = {
    projectId: PROJECT,
    revision: 3,
    base: new Uint8Array(Buffer.from('base')),
    draft: new Uint8Array(Buffer.from('draft')),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.aiWorkspace.findUnique.mockResolvedValue(held);
  });

  it('starts the assistant from the latest user save', async () => {
    prisma.aiWorkspace.findUnique.mockResolvedValueOnce(null);
    content.fetchLastVersion.mockResolvedValue({ body: Readable.from([Buffer.from('saved')]) });
    prisma.aiWorkspace.upsert.mockImplementation(({ create }: { create: typeof held }) => ({
      ...held,
      ...create,
      revision: 1,
    }));
    const read = await service.read(PROJECT);
    expect(Buffer.from(read.snapshot, 'base64').toString()).toBe('saved');
    expect(read.revision).toBe(1);
  });

  it('refuses a write made against a revision since replaced', async () => {
    prisma.aiWorkspace.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.write(PROJECT, { revision: 2, snapshot: b64('next') }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.aiWorkspace.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: PROJECT, revision: 2 } }),
    );
  });

  it('refuses an empty or oversized state', async () => {
    await expect(service.write(PROJECT, { revision: 3, snapshot: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const huge = Buffer.alloc(PROJECT_BLOB_MAX_BYTES + 1).toString('base64');
    await expect(service.write(PROJECT, { revision: 3, snapshot: huge })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('hands a review its own document as the next base, and adds what the kept changes touched', async () => {
    tx.aiWorkspace.updateMany.mockResolvedValue({ count: 1 });
    await service.review(PROJECT, USER, {
      revision: 3,
      base: b64('reviewed'),
      draft: b64('pending'),
      categories: ['CODE', 'MAPS'],
    });
    expect(ai.authorize).toHaveBeenCalledWith(PROJECT, USER);
    const write = (
      tx.aiWorkspace.updateMany.mock.calls[0] as [{ data: { base: Uint8Array; draft: Uint8Array } }]
    )[0];
    expect(Buffer.from(write.data.base).toString()).toBe('reviewed');
    expect(Buffer.from(write.data.draft).toString()).toBe('pending');
    expect(tx.project.updateMany).toHaveBeenCalledTimes(2);
  });

  it('shows the editor nothing before the assistant wrote anything, and makes nothing', async () => {
    prisma.aiWorkspace.findUnique.mockResolvedValueOnce(null);
    await expect(service.forEditor(PROJECT, USER)).resolves.toEqual({
      revision: 0,
      draft: null,
      base: null,
      updatedAt: null,
    });
    expect(prisma.aiWorkspace.upsert).not.toHaveBeenCalled();
  });
});
