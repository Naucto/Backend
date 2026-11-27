import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_TOKEN_COOLDOWN_MS,
  EMAIL_TOKEN_LIFETIME_MS,
  EmailTokenService,
} from './email-token.service';

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

describe('EmailTokenService', () => {
  let prisma: {
    emailToken: {
      updateMany: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let service: EmailTokenService;

  beforeEach(() => {
    prisma = {
      emailToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
      },
    };
    service = new EmailTokenService(prisma as unknown as PrismaService);
  });

  it('should store only the digest of a fresh token for an account that has none', async () => {
    const token = await service.issue(3, 'RESET_PASSWORD');

    expect(token).not.toBeNull();
    expect(token!.length).toBeGreaterThanOrEqual(43);
    const { data } = prisma.emailToken.create.mock.calls[0][0];
    expect(data).toMatchObject({ userId: 3, purpose: 'RESET_PASSWORD' });
    expect(data.tokenHash).toBe(digest(token!));
    expect(data.tokenHash).not.toBe(token);
    expect(data.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      EMAIL_TOKEN_LIFETIME_MS.RESET_PASSWORD,
    );
  });

  it('should replace the link only when it is older than the cooldown', async () => {
    prisma.emailToken.updateMany.mockResolvedValue({ count: 1 });

    const token = await service.issue(3, 'VERIFY_EMAIL');

    const { where, data } = prisma.emailToken.updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ userId: 3, purpose: 'VERIFY_EMAIL' });
    expect(Date.now() - where.createdAt.lte.getTime()).toBeGreaterThanOrEqual(
      EMAIL_TOKEN_COOLDOWN_MS,
    );
    expect(data.tokenHash).toBe(digest(token!));
    expect(prisma.emailToken.create).not.toHaveBeenCalled();
  });

  it('should issue nothing while the link is cooling down or another request claimed it', async () => {
    prisma.emailToken.updateMany.mockResolvedValue({ count: 0 });
    prisma.emailToken.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.issue(3, 'VERIFY_EMAIL')).resolves.toBeNull();
  });

  it('should let any other database error through', async () => {
    const failure = new Error('connection lost');
    prisma.emailToken.create.mockRejectedValue(failure);

    await expect(service.issue(3, 'VERIFY_EMAIL')).rejects.toBe(failure);
  });

  it('should hand two calls two different tokens', async () => {
    expect(await service.issue(3, 'VERIFY_EMAIL')).not.toBe(await service.issue(3, 'VERIFY_EMAIL'));
  });

  it('should spend a valid token and return its account', async () => {
    prisma.emailToken.findUnique.mockResolvedValue({
      id: 9,
      userId: 3,
      purpose: 'VERIFY_EMAIL',
      expiresAt: new Date(Date.now() + 1000),
    });

    await expect(
      service.consume('tok', 'VERIFY_EMAIL', prisma as unknown as PrismaService),
    ).resolves.toBe(3);
    expect(prisma.emailToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: digest('tok') },
    });
    expect(prisma.emailToken.deleteMany).toHaveBeenCalledWith({ where: { id: 9 } });
  });

  it.each([
    ['unknown', null, 1, false],
    ['of another purpose', { purpose: 'RESET_PASSWORD' }, 1, false],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }, 1, true],
    ['spent by a concurrent request', {}, 0, true],
  ])('should refuse a token that is %s', async (_case, row, deleted, spent) => {
    prisma.emailToken.findUnique.mockResolvedValue(
      row === null
        ? null
        : {
            id: 9,
            userId: 3,
            purpose: 'VERIFY_EMAIL',
            expiresAt: new Date(Date.now() + 1000),
            ...row,
          },
    );
    prisma.emailToken.deleteMany.mockResolvedValue({ count: deleted });

    await expect(
      service.consume('tok', 'VERIFY_EMAIL', prisma as unknown as PrismaService),
    ).resolves.toBeNull();
    if (spent) {
      expect(prisma.emailToken.deleteMany).toHaveBeenCalledWith({ where: { id: 9 } });
    } else {
      expect(prisma.emailToken.deleteMany).not.toHaveBeenCalled();
    }
  });
});
