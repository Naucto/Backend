/** The code of the 403 a suspended account gets where suspension refuses it. */
export const ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED';

/** The columns of an account that say whether moderation has suspended it. */
export interface SuspensionState {
  suspendedAt: Date | null;
  suspendedUntil: Date | null;
}

export interface Suspension {
  since: Date;
  /** Null when only staff can lift it. */
  until: Date | null;
}

/**
 * The suspension an account is under at `now`, or null. One with an end date lifts itself: nothing
 * clears the columns when it passes, so every reader goes through here rather than the columns.
 */
export function currentSuspension(
  account: Partial<SuspensionState>,
  now: Date = new Date(),
): Suspension | null {
  if (!account.suspendedAt) {
    return null;
  }
  const until = account.suspendedUntil ?? null;
  if (until !== null && until <= now) {
    return null;
  }
  return { since: account.suspendedAt, until };
}
