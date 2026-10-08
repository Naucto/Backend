import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Counts failures per key in a fixed window that starts at the first failure, so a lockout always
 * ends and an attacker cannot hold someone out by failing on their behalf forever. Held in memory:
 * the backend runs as one instance, and a restart only gives back the attempts of one window.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  assertAllowed(key: string): void {
    const entry = this.current(key);
    if (entry && entry.count >= this.maxFailures) {
      const minutes = Math.ceil((entry.resetAt - this.now()) / 60_000);
      throw new HttpException(
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  fail(key: string): void {
    const entry = this.current(key);
    if (entry) {
      entry.count += 1;
    } else {
      this.failures.set(key, { count: 1, resetAt: this.now() + this.windowMs });
    }
  }

  clear(key: string): void {
    this.failures.delete(key);
  }

  private current(key: string): { count: number; resetAt: number } | undefined {
    const entry = this.failures.get(key);
    if (entry && entry.resetAt <= this.now()) {
      this.failures.delete(key);
      return undefined;
    }
    return entry;
  }
}
