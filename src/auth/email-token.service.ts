import { Injectable } from '@nestjs/common';
import { EmailTokenPurpose, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';

const HOURS = 60 * 60 * 1000;

export const EMAIL_TOKEN_LIFETIME_MS: Record<EmailTokenPurpose, number> = {
  VERIFY_EMAIL: 24 * HOURS,
  RESET_PASSWORD: 1 * HOURS,
};

export const EMAIL_TOKEN_COOLDOWN_MS = 10 * 1000;

const TOKEN_BYTES = 32;

function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class EmailTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** A fresh link for the purpose, replacing any the account was sent before. */
  async issue(
    userId: number,
    purpose: EmailTokenPurpose,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');

    await db.emailToken.deleteMany({ where: { userId, purpose } });
    await db.emailToken.create({
      data: {
        userId,
        purpose,
        tokenHash: digestOf(token),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_LIFETIME_MS[purpose]),
      },
    });

    return token;
  }

  /**
   * The account the token was issued to, or null when it is unknown, of another purpose or
   * expired. A token is spent by the call that reads it, whether it was still valid or not.
   */
  async consume(
    token: string,
    purpose: EmailTokenPurpose,
    db: Prisma.TransactionClient,
  ): Promise<number | null> {
    const stored = await db.emailToken.findUnique({ where: { tokenHash: digestOf(token) } });
    if (!stored || stored.purpose !== purpose) {
      return null;
    }

    // Two requests may present the same link at once; only the one that removes the row wins.
    const { count } = await db.emailToken.deleteMany({ where: { id: stored.id } });
    if (count === 0 || stored.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return stored.userId;
  }

  /** Whether a link of this purpose went to the account too recently to send another. */
  async isCoolingDown(userId: number, purpose: EmailTokenPurpose): Promise<boolean> {
    const recent = await this.prisma.emailToken.count({
      where: {
        userId,
        purpose,
        createdAt: { gt: new Date(Date.now() - EMAIL_TOKEN_COOLDOWN_MS) },
      },
    });
    return recent > 0;
  }
}
