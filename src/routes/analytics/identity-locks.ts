import { Prisma } from '@prisma/client';

/**
 * Transaction-scoped advisory locks over analytics identities. Every writer that can create or
 * reach an account's analytics takes them, always in the order purge gate, account, then
 * visitors in key order, so two writers never wait on each other in a cycle. They only coordinate the callers
 * that take them: a writer added without them is not protected by them.
 */
const ACCOUNT_LOCK_CLASS = 1;
const VISITOR_LOCK_CLASS = 2;
const PURGE_GATE_LOCK_CLASS = 3;

export type LockMode = 'shared' | 'exclusive';

/**
 * Taken before any other identity lock. The purge holds it exclusively while it checks that no
 * linked visitor still needs a day's raw data and deletes that day; a link holds it shared, so a
 * link either lands before the check and is seen by it, or waits until the day is gone.
 */
export async function lockPurgeGate(tx: Prisma.TransactionClient, mode: LockMode): Promise<void> {
  if (mode === 'shared') {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${PURGE_GATE_LOCK_CLASS}::int, 0)`;
  } else {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PURGE_GATE_LOCK_CLASS}::int, 0)`;
  }
}

export async function lockAccount(
  tx: Prisma.TransactionClient,
  userId: number,
  mode: LockMode,
): Promise<void> {
  if (mode === 'shared') {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${ACCOUNT_LOCK_CLASS}::int, ${userId}::int)`;
  } else {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ACCOUNT_LOCK_CLASS}::int, ${userId}::int)`;
  }
}

/** Locks every visitor in hash order; two ids sharing a hash share a lock, which only waits more. */
export async function lockVisitors(
  tx: Prisma.TransactionClient,
  visitorIds: readonly string[],
  mode: LockMode,
): Promise<void> {
  if (visitorIds.length === 0) {
    return;
  }
  const ids = [...new Set(visitorIds)];
  if (mode === 'shared') {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock_shared(${VISITOR_LOCK_CLASS}::int, key)
      FROM (SELECT DISTINCT hashtext(id) AS key FROM unnest(${ids}::text[]) AS id ORDER BY key) AS keys`;
  } else {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(${VISITOR_LOCK_CLASS}::int, key)
      FROM (SELECT DISTINCT hashtext(id) AS key FROM unnest(${ids}::text[]) AS id ORDER BY key) AS keys`;
  }
}
