import { Prisma } from '@prisma/client';

import {
  releaseViewKeyOfUser,
  releaseViewKeyOfVisitor,
} from '../analytics/analytics-erasure.service';
import { lockVisitors } from '../analytics/identity-locks';

/**
 * Who is looking, for counting a view once a day: the account a consenting browser is linked to,
 * else the browser itself. Read under the visitor's shared identity lock, so an erasure holding it
 * can never be followed by a key it already removed. An erased visitor has no key.
 */
export async function viewerKeyOf(
  tx: Prisma.TransactionClient,
  visitorId: string,
): Promise<string | null> {
  await lockVisitors(tx, [visitorId], 'shared');
  if (await tx.analyticsVisitorTombstone.findUnique({ where: { id: visitorId } })) {
    return null;
  }
  const visitor = await tx.analyticsVisitor.findUnique({
    where: { id: visitorId },
    select: { userId: true },
  });
  return visitor?.userId != null
    ? releaseViewKeyOfUser(visitor.userId)
    : releaseViewKeyOfVisitor(visitorId);
}
