import { FlagStatus, ModerationTargetType, Prisma } from '@prisma/client';

export interface FlagResolution {
  targetType: ModerationTargetType;
  targetId: number;
  status: Exclude<FlagStatus, 'OPEN'>;
  resolvedById: number;
  /** The log row of the decision that settles them. */
  resolutionId: number;
}

/**
 * Closes every open flag on a target, in the transaction of the decision that settles them.
 * Clearing `openKey` is what lets the same reporter flag the target again later.
 */
export async function resolveOpenFlags(
  tx: Prisma.TransactionClient,
  resolution: FlagResolution,
): Promise<number> {
  const { count } = await tx.flag.updateMany({
    where: {
      targetType: resolution.targetType,
      targetId: resolution.targetId,
      status: FlagStatus.OPEN,
    },
    data: {
      status: resolution.status,
      openKey: null,
      resolvedById: resolution.resolvedById,
      resolvedAt: new Date(),
      resolutionId: resolution.resolutionId,
    },
  });
  return count;
}
