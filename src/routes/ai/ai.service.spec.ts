import { createHash } from 'node:crypto';

import { ConflictException, UnauthorizedException } from '@nestjs/common';

import { uuidOf } from '../../../test/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from './ai.service';

const OWNER = uuidOf(1);
const TOKEN = `naucto_k_${'a'.repeat(64)}`;
const BEARER = `Bearer ${TOKEN}`;
const tokenHash = createHash('sha256').update(TOKEN).digest('hex');

describe('AiService', () => {
  const prisma = {
    aiKey: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn() },
    project: { findMany: jest.fn() },
  };
  const service = new AiService(prisma as unknown as PrismaService);
  const live = {
    id: uuidOf(9),
    userId: OWNER,
    revokedAt: null,
    expiresAt: null,
    lastUsedAt: new Date(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.aiKey.findUnique.mockResolvedValue(live);
  });

  it('keeps only the hash of the key it hands out', async () => {
    prisma.aiKey.count.mockResolvedValue(0);
    prisma.aiKey.create.mockImplementation(({ data }: { data: { tokenHash: string } }) => ({
      ...live,
      name: 'laptop',
      createdAt: new Date(),
      tokenHash: data.tokenHash,
    }));
    const made = await service.createKey(OWNER, 'laptop');
    const stored = (prisma.aiKey.create.mock.calls[0] as [{ data: { tokenHash: string } }])[0].data;
    expect(made.token).toMatch(/^naucto_k_[a-f0-9]{64}$/);
    expect(stored.tokenHash).toBe(createHash('sha256').update(made.token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(made.token);
  });

  it('points a key at the one project its account owns', async () => {
    prisma.project.findMany.mockResolvedValue([{ id: uuidOf(5), name: 'Cave' }]);
    await expect(service.connection(BEARER)).resolves.toMatchObject({
      projectId: uuidOf(5),
      userId: OWNER,
    });
    expect(prisma.aiKey.findUnique).toHaveBeenCalledWith({ where: { tokenHash } });
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: OWNER } }),
    );
  });

  it('will not guess between several projects', async () => {
    prisma.project.findMany.mockResolvedValue([
      { id: uuidOf(5), name: 'Cave' },
      { id: uuidOf(6), name: 'Ferry' },
    ]);
    await expect(service.connection(BEARER)).rejects.toBeInstanceOf(ConflictException);
  });

  it('reaches only the projects of the account, named by the header', async () => {
    prisma.project.findMany.mockResolvedValue([]);
    await expect(service.connection(BEARER, uuidOf(7))).rejects.toThrow(
      'This key does not reach that project',
    );
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: OWNER, id: uuidOf(7) } }),
    );
    await expect(service.connection(BEARER, '7')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a revoked or expired key, and anything that is not a key', async () => {
    prisma.aiKey.findUnique.mockResolvedValueOnce({ ...live, revokedAt: new Date() });
    await expect(service.connection(BEARER)).rejects.toBeInstanceOf(UnauthorizedException);
    prisma.aiKey.findUnique.mockResolvedValueOnce({ ...live, expiresAt: new Date(0) });
    await expect(service.connection(BEARER)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.connection('Bearer some-jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
