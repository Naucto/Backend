import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { lockAccount, lockVisitors } from './identity-locks';

/** The keys `registerView` stores for a viewer, so erasure can find them again. */
export const releaseViewKeyOfUser = (userId: number): string => `u:${String(userId)}`;
export const releaseViewKeyOfVisitor = (visitorId: string): string => `v:${visitorId}`;

/**
 * Removes everything that links analytics to an account. Final rollups hold no identifier and
 * stay, so this only changes periods finalized afterwards.
 */
@Injectable()
export class AnalyticsErasureService {
  constructor(private readonly prisma: PrismaService) {}

  async erase(userId: number): Promise<number> {
    return this.prisma.$transaction((tx) => this.eraseWithin(tx, userId));
  }

  /**
   * Runs inside the caller's transaction, so account deletion can mark the account deleted in the
   * same commit: a fact writer waiting on the account lock then sees the deletion.
   *
   * @returns how many visitors were erased.
   */
  async eraseWithin(tx: Prisma.TransactionClient, userId: number): Promise<number> {
    await lockAccount(tx, userId, 'exclusive');

    const visitors = await tx.analyticsVisitor.findMany({
      where: { userId },
      select: { id: true },
    });
    const visitorIds = visitors.map((visitor) => visitor.id);
    await lockVisitors(tx, visitorIds, 'exclusive');

    // Tombstoned first: anything still queued under these ids is refused instead of recreating them.
    await tx.analyticsVisitorTombstone.createMany({
      data: visitorIds.map((id) => ({ id })),
      skipDuplicates: true,
    });
    await tx.releaseView.deleteMany({
      where: {
        viewerKey: {
          in: [releaseViewKeyOfUser(userId), ...visitorIds.map(releaseViewKeyOfVisitor)],
        },
      },
    });
    await tx.analyticsLiveMinute.deleteMany({ where: { visitorId: { in: visitorIds } } });
    await tx.analyticsProjectionWork.deleteMany({ where: { userId } });
    await tx.analyticsUserDaily.deleteMany({ where: { userId } });
    // Sessions, session days, page views, plays and play days go with their visitor.
    await tx.analyticsVisitor.deleteMany({ where: { id: { in: visitorIds } } });
    await tx.analyticsFact.updateMany({
      where: { actorUserId: userId },
      data: { actorUserId: null },
    });

    return visitorIds.length;
  }
}
