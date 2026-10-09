import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AnalyticsLiveState } from '@prisma/client';

import { PresenceService } from '../../presence/presence.service';
import { PresenceKind } from '../../presence/presence.types';
import { PrismaService } from '../../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { MINUTE_MS, minuteStart } from './analytics-time';

/** Live minutes are kept this long: the sampler and the live view only read recent ones. */
const LIVE_MINUTE_RETENTION_MS = 2 * 60 * MINUTE_MS;

type StateCounts = Record<AnalyticsLiveState, number>;

const ACCOUNT_STATE: Record<PresenceKind, AnalyticsLiveState> = {
  IDLE: AnalyticsLiveState.BROWSING,
  PLAYING: AnalyticsLiveState.PLAYING,
  BUILDING: AnalyticsLiveState.BUILDING,
  HOSTING: AnalyticsLiveState.HOSTING,
};

const emptyCounts = (): StateCounts => ({ BROWSING: 0, BUILDING: 0, PLAYING: 0, HOSTING: 0 });

const total = (counts: StateCounts): number =>
  counts.BROWSING + counts.BUILDING + counts.PLAYING + counts.HOSTING;

/**
 * Writes one presence sample per minute: consenting browsers seen in the minute, anonymous pings
 * received in it, and accounts online when it is taken. A minute is sampled 90 seconds after it
 * starts, once every instance has flushed its pings for it.
 */
@Injectable()
export class AnalyticsSamplerService {
  private readonly logger = new Logger(AnalyticsSamplerService.name);
  private readonly bootedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly features: FeaturesService,
  ) {}

  @Cron('30 * * * * *', { timeZone: 'UTC' })
  async sampleLastMinute(now = new Date()): Promise<void> {
    if (!this.features.features.analytics) {
      return;
    }
    const minute = minuteStart(new Date(now.getTime() - 90_000));
    // A minute this process was not up for is left unsampled: a gap, never a false zero.
    if (minute.getTime() < this.bootedAt) {
      return;
    }
    try {
      await this.sample(minute);
    } catch (error) {
      this.logger.warn(`Presence sample of ${minute.toISOString()} failed: ${String(error)}`);
    }
  }

  async sample(minute: Date): Promise<void> {
    const accounts = emptyCounts();
    for (const [kind, count] of Object.entries(this.presence.countsByKind())) {
      accounts[ACCOUNT_STATE[kind as PresenceKind]] += count;
    }

    await this.prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
        SELECT pg_try_advisory_xact_lock(hashtext('analytics-sampler')) AS locked`;
      if (!locked) {
        return;
      }

      const browsers = emptyCounts();
      for (const row of await tx.$queryRaw<{ state: AnalyticsLiveState; count: number }[]>`
        SELECT "state", count(*)::int AS count FROM "AnalyticsLiveMinute"
        WHERE "minute" = ${minute} GROUP BY "state"`) {
        browsers[row.state] = row.count;
      }
      const anonymous = emptyCounts();
      for (const row of await tx.$queryRaw<{ state: AnalyticsLiveState; count: number }[]>`
        SELECT "state", COALESCE(sum("beats"), 0)::int AS count FROM "AnalyticsAnonTally"
        WHERE "minute" = ${minute} GROUP BY "state"`) {
        anonymous[row.state] = row.count;
      }

      await tx.concurrencySample.createMany({
        data: [
          {
            at: minute,
            activeBrowsers: total(browsers),
            activeBrowsersPlaying: browsers.PLAYING,
            activeBrowsersBuilding: browsers.BUILDING,
            activeBrowsersHosting: browsers.HOSTING,
            anonTabs: total(anonymous),
            anonTabsPlaying: anonymous.PLAYING,
            anonTabsBuilding: anonymous.BUILDING,
            anonTabsHosting: anonymous.HOSTING,
            accounts: total(accounts),
            accountsPlaying: accounts.PLAYING,
            accountsBuilding: accounts.BUILDING,
            accountsHosting: accounts.HOSTING,
          },
        ],
        skipDuplicates: true,
      });
      await tx.analyticsLiveMinute.deleteMany({
        where: { minute: { lt: new Date(minute.getTime() - LIVE_MINUTE_RETENTION_MS) } },
      });
    });
  }
}
