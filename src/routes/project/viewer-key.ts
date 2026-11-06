import { Prisma } from '@prisma/client';
import { createHmac } from 'crypto';

import { getEnv, getOptionalEnv } from '../../config/env';
import { releaseViewKeyOfUser } from '../analytics/analytics-erasure.service';
import { lockAccount } from '../analytics/identity-locks';

/** Address flags are forgotten after this long; an address back later counts as a new player. */
export const ADDRESS_VIEW_RETENTION_DAYS = 90;

/** Not `ip:`, which `repair:release-view-keys` deletes as the leftovers of an older scheme. */
export const ADDRESS_VIEW_KEY_PREFIX = 'addr:';

/** IPv4 as a dual-stack socket reports it, `::ffff:a.b.c.d`, made plain. */
const plainAddress = (address: string): string =>
  /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1] ?? address;

/**
 * A one-way code standing for a network address: it can tell the same address apart from another,
 * never give the address back.
 */
export function addressViewKey(address: string): string {
  const secret = getOptionalEnv('VIEW_HASH_SECRET') ?? getEnv('JWT_SECRET');
  const code = createHmac('sha256', secret)
    .update(plainAddress(address))
    .digest('base64url')
    .slice(0, 22);
  return `${ADDRESS_VIEW_KEY_PREFIX}${code}`;
}

/**
 * Who is looking, for counting a view once a day: the signed-in account, else the network address.
 * Consent to analytics plays no part. The account is read under its shared identity lock, so an
 * erasure holding it is never followed by a key it already removed. No address, no key.
 */
export async function viewerKeyOf(
  tx: Prisma.TransactionClient,
  viewer: { userId: number | null; address: string },
): Promise<string | null> {
  if (viewer.userId !== null) {
    await lockAccount(tx, viewer.userId, 'shared');
    return releaseViewKeyOfUser(viewer.userId);
  }
  return viewer.address ? addressViewKey(viewer.address) : null;
}
