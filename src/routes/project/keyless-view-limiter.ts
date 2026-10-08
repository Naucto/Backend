/** A view from a browser that declined analytics counts once per this window per budget. */
const WINDOW_MS = 10 * 60_000;
/** Enough for a whole class opening the same game behind one address. */
export const KEYLESS_VIEWS_PER_RELEASE = 30;
export const KEYLESS_VIEWS_PER_ADDRESS = 300;
/** Budgets tracked at most; past it the oldest are forgotten, so memory never grows unbounded. */
const CAPACITY = 50_000;

/**
 * Limits how many views without a viewer one address adds, so the public popularity of a game is
 * hard to inflate. The address only keys a window held in memory for ten minutes; it is never
 * stored.
 */
export class KeylessViewLimiter {
  private readonly windows = new Map<string, number[]>();

  /** Spends one view of both budgets of the address, or none when either is spent. */
  admit(address: string, releaseId: number, now = Date.now()): boolean {
    const perRelease = `${address}|${String(releaseId)}`;
    const perAddress = address;
    if (
      this.used(perRelease, now) >= KEYLESS_VIEWS_PER_RELEASE ||
      this.used(perAddress, now) >= KEYLESS_VIEWS_PER_ADDRESS
    ) {
      return false;
    }
    this.spend(perRelease, now);
    this.spend(perAddress, now);
    return true;
  }

  private used(key: string, now: number): number {
    const window = this.windows.get(key);
    if (!window) {
      return 0;
    }
    const live = window.filter((at) => now - at < WINDOW_MS);
    if (live.length === 0) {
      this.windows.delete(key);
    } else {
      this.windows.set(key, live);
    }
    return live.length;
  }

  private spend(key: string, now: number): void {
    if (!this.windows.has(key) && this.windows.size >= CAPACITY) {
      const oldest = this.windows.keys().next();
      if (!oldest.done) {
        this.windows.delete(oldest.value);
      }
    }
    const window = this.windows.get(key) ?? [];
    window.push(now);
    this.windows.set(key, window);
  }
}
