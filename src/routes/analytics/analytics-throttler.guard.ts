import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

import { AnalyticsTallyService } from './analytics-tally.service';

const MINUTE_MS = 60_000;

interface ThrottledRequest {
  ip?: string;
  user?: { id: number } | null;
  body?: unknown;
}

/** The account for a signed-in call, else the browser's visitor id, else the address. */
function identityOf(req: ThrottledRequest): string {
  if (req.user) {
    return `u:${String(req.user.id)}`;
  }
  const visitorId =
    typeof req.body === 'object' && req.body !== null
      ? (req.body as { visitorId?: unknown }).visitorId
      : undefined;
  // Unvalidated still: a forged id only spends its own budget, and the address ceiling stays.
  if (typeof visitorId === 'string' && visitorId.length <= 64) {
    return `v:${visitorId}`;
  }
  return `ip:${req.ip ?? ''}`;
}

/**
 * Two budgets per route: one per browser or account, and a generous one per address, sized so a
 * whole school behind one address is never throttled in normal use.
 */
export const ANALYTICS_THROTTLERS: ThrottlerOptions[] = [
  {
    name: 'identity',
    ttl: MINUTE_MS,
    limit: 120,
    getTracker: (req): string => identityOf(req as ThrottledRequest),
  },
  {
    name: 'ip',
    ttl: MINUTE_MS,
    limit: 6_000,
    getTracker: (req): string => `ip:${(req as ThrottledRequest).ip ?? ''}`,
  },
];

/** The throttler guard, counting what it refuses into the ingest statistics. */
@Injectable()
export class AnalyticsThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly tally: AnalyticsTallyService,
  ) {
    super(options, storage, reflector);
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    this.tally.count('throttled');
    await super.throwThrottlingException(context, detail);
  }
}
