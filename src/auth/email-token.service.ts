import { Injectable } from '@nestjs/common';
import { EmailTokenPurpose, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';

const HOURS = 60 * 60 * 1000;

export const EMAIL_TOKEN_LIFETIME_MS: Record<EmailTokenPurpose, number> = {
  VERIFY_EMAIL: 24 * HOURS,
  RESET_PASSWORD: 1 * HOURS,
};

export const EMAIL_TOKEN_COOLDOWN_MS = 60 * 1000;

const TOKEN_BYTES = 32;

function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class EmailTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A fresh link for the purpose, replacing the one the account was sent before, or null when a
   * link of the purpose went out less than a cooldown ago. The check and the write are one
   * statement, so of many requests racing for the same account only one is handed a link.
   */
  async issue(
    userId: number,
    purpose: EmailTokenPurpose,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string | null> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const now = new Date();
    const fresh = {
      tokenHash: digestOf(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + EMAIL_TOKEN_LIFETIME_MS[purpose]),
    };

    // A racing request holds the row until it commits, and this one then reads its new createdAt.
    const { count: replaced } = await db.emailToken.updateMany({
      where: {
        userId,
        purpose,
        createdAt: { lte: new Date(now.getTime() - EMAIL_TOKEN_COOLDOWN_MS) },
      },
      data: fresh,
    });
    if (replaced > 0) {
      return token;
    }

    // No row old enough: either none exists, or one is still cooling down. The unique key on
    // (userId, purpose) lets only one create through; a P2002 means another request won.
    try {
      await db.emailToken.create({ data: { userId, purpose, ...fresh } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
    return token;
  }

  /**
   * The account the token was issued to, or null when it is unknown, of another purpose or
   * expired. A token of the purpose asked for is spent by the call that reads it, whether it was
   * still valid or not; one of another purpose is left alone, so presenting a reset link where a
   * confirmation is expected does not spend it.
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
}
