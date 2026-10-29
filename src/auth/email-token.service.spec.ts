import { createHash } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_TOKEN_LIFETIME_MS, EmailTokenService } from './email-token.service';

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

describe('EmailTokenService', () => {
  let prisma: {
    emailToken: {
      create: jest.Mock;
      deleteMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
    };
  };
  let service: EmailTokenService;

  beforeEach(() => {
    prisma = {
      emailToken: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
    };
    service = new EmailTokenService(prisma as unknown as PrismaService);
  });

  it('should store only the digest of a fresh token and drop the older ones', async () => {
    const token = await service.issue(3, 'RESET_PASSWORD');

    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(prisma.emailToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 3, purpose: 'RESET_PASSWORD' },
    });
    const { data } = prisma.emailToken.create.mock.calls[0][0];
    expect(data.tokenHash).toBe(digest(token));
    expect(data.tokenHash).not.toBe(token);
    expect(data.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      EMAIL_TOKEN_LIFETIME_MS.RESET_PASSWORD,
    );
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
    ['unknown', null, 1],
    ['of another purpose', { purpose: 'RESET_PASSWORD' }, 1],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }, 1],
    ['spent by a concurrent request', {}, 0],
  ])('should refuse a token that is %s', async (_case, row, deleted) => {
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
  });

  it('should cool down while a link of the purpose went out in the last minute', async () => {
    prisma.emailToken.count.mockResolvedValue(1);
    await expect(service.isCoolingDown(3, 'VERIFY_EMAIL')).resolves.toBe(true);

    prisma.emailToken.count.mockResolvedValue(0);
    await expect(service.isCoolingDown(3, 'VERIFY_EMAIL')).resolves.toBe(false);
  });
});
