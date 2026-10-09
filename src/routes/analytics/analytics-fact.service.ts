import { Injectable } from '@nestjs/common';
import { AnalyticsFactType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { lockAccount } from './identity-locks';

export interface AnalyticsFactInput {
  type: AnalyticsFactType;
  /** Unique per business transition and never derived from an account id. */
  dedupeKey: string;
  actorUserId: number | null;
  projectId?: number;
}

export const signupFactKey = (): string => `signup:${randomUUID()}`;
export const projectCreatedFactKey = (projectId: number): string => `project:${String(projectId)}`;
export const releaseFactKey = (projectId: number, revision: number): string =>
  `release:${String(projectId)}:${String(revision)}`;

/** Records business transitions in the transaction that performs them. */
@Injectable()
export class AnalyticsFactService {
  /**
   * Holds the actor's account lock while it reads whether the account was deleted, so a fact
   * racing an account deletion either lands first and is unlinked by it, or waits and is written
   * without an actor. After an analytics erasure the account is live and the actor is kept: that
   * is fresh activity.
   */
  async record(tx: Prisma.TransactionClient, fact: AnalyticsFactInput): Promise<void> {
    let actorUserId = fact.actorUserId;
    if (actorUserId !== null) {
      await lockAccount(tx, actorUserId, 'shared');
      const actor = await tx.user.findUnique({
        where: { id: actorUserId },
        select: { deletedAt: true },
      });
      if (!actor || actor.deletedAt) {
        actorUserId = null;
      }
    }

    await tx.analyticsFact.createMany({
      data: [
        {
          type: fact.type,
          dedupeKey: fact.dedupeKey,
          actorUserId,
          projectId: fact.projectId ?? null,
        },
      ],
      skipDuplicates: true,
    });
  }
}
