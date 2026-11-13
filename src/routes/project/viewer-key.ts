import { Prisma } from '@prisma/client';
import { createHmac } from 'crypto';

import { releaseViewKeyOfUser } from '../analytics/analytics-erasure.service';
import { lockAccount } from '../analytics/identity-locks';

/** Account flags are forgotten after this long; an account back later counts as a new player. */
export const ACCOUNT_VIEW_RETENTION_DAYS = 90;

/** Not `ip:`, which `repair:release-view-keys` deletes as the leftovers of an older scheme. */
export const ADDRESS_VIEW_KEY_PREFIX = 'addr:';

/**
 * A one-way code standing for a network address under one day's salt: it tells the same address
 * apart from another on that day, and never gives the address back.
 */
export function addressViewKey(address: string, salt: Buffer): string {
  const code = createHmac('sha256', salt).update(address).digest('base64url').slice(0, 22);
  return `${ADDRESS_VIEW_KEY_PREFIX}${code}`;
}

/**
 * Who is looking, for counting a view once a day: the signed-in account, else the network address.
 * Consent to analytics plays no part. The account is read under its shared identity lock, so a
 * view racing an erasure or an account deletion either lands first and is removed by it, or waits
 * and sees the account gone. A deleted account has no key, and neither has a reader without an
 * address.
 */
export async function viewerKeyOf(
  tx: Prisma.TransactionClient,
  viewer: { userId: number | null; address: string },
  salt: Buffer,
): Promise<string | null> {
  if (viewer.userId !== null) {
    await lockAccount(tx, viewer.userId, 'shared');
    const account = await tx.user.findUnique({
      where: { id: viewer.userId },
      select: { deletedAt: true },
    });
    return account && !account.deletedAt ? releaseViewKeyOfUser(viewer.userId) : null;
  }
  return viewer.address ? addressViewKey(viewer.address, salt) : null;
}
