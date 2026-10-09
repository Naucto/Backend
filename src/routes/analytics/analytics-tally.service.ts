import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AnalyticsLiveState, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { hostname } from 'os';

import { PrismaService } from '../../prisma/prisma.service';
import { minuteStart } from './analytics-time';
import { PingKind } from './dto/analytics-ingest.dto';

export const TALLY_FLUSH_INTERVAL_MS = 10_000;

export type IngestOutcome = 'accepted' | 'rejected' | 'throttled' | 'writeErrors';

interface PingTally {
  minute: Date;
  state: AnalyticsLiveState;
  signedIn: boolean;
  releaseId: number;
  beats: number;
  playsStarted: number;
  playMs: number;
}

type IngestTally = { minute: Date } & Record<IngestOutcome, number>;

export interface PingInput {
  kind: PingKind;
  state: AnalyticsLiveState;
  signedIn: boolean;
  /** 0 when the tab is not on a published game. */
  releaseId: number;
  playMs: number;
}

/**
 * Tallies identifier-free pings and ingest outcomes in memory and adds them to their minute rows
 * every few seconds. The writes only add, so any number of instances can flush into the same rows;
 * a crashed instance loses at most one interval.
 */
@Injectable()
export class AnalyticsTallyService implements OnApplicationShutdown {
  readonly instanceId = `${hostname()}-${String(process.pid)}-${randomUUID().slice(0, 8)}`;
  private readonly logger = new Logger(AnalyticsTallyService.name);
  private pings = new Map<string, PingTally>();
  private outcomes = new Map<string, IngestTally>();

  constructor(private readonly prisma: PrismaService) {}

  recordPing(ping: PingInput, at = new Date()): void {
    const minute = minuteStart(at);
    const key = `${minute.toISOString()}|${ping.state}|${String(ping.signedIn)}|${String(ping.releaseId)}`;
    let tally = this.pings.get(key);
    if (!tally) {
      tally = {
        minute,
        state: ping.state,
        signedIn: ping.signedIn,
        releaseId: ping.releaseId,
        beats: 0,
        playsStarted: 0,
        playMs: 0,
      };
      this.pings.set(key, tally);
    }
    if (ping.kind === 'BEAT') {
      tally.beats += 1;
    }
    if (ping.kind === 'PLAY_START') {
      tally.playsStarted += 1;
    }
    tally.playMs += ping.playMs;
  }

  count(outcome: IngestOutcome, at = new Date(), by = 1): void {
    const minute = minuteStart(at);
    const key = minute.toISOString();
    let tally = this.outcomes.get(key);
    if (!tally) {
      tally = { minute, accepted: 0, rejected: 0, throttled: 0, writeErrors: 0 };
      this.outcomes.set(key, tally);
    }
    tally[outcome] += by;
  }

  @Interval(TALLY_FLUSH_INTERVAL_MS)
  async flush(): Promise<void> {
    if (this.pings.size === 0 && this.outcomes.size === 0) {
      return;
    }
    const pings = this.pings;
    const outcomes = this.outcomes;
    this.pings = new Map();
    this.outcomes = new Map();

    try {
      await this.prisma.$transaction([
        ...[...pings.values()].map((tally) => this.addPings(tally)),
        ...[...outcomes.values()].map((tally) => this.addOutcomes(tally)),
      ]);
    } catch (error) {
      // All or nothing: the tallies go back and are added again by the next flush.
      for (const [key, tally] of pings) {
        this.mergePings(key, tally);
      }
      for (const [key, tally] of outcomes) {
        this.mergeOutcomes(key, tally);
      }
      this.logger.warn(`Analytics tallies kept for the next flush: ${String(error)}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }

  private addPings(tally: PingTally): Prisma.PrismaPromise<number> {
    return this.prisma.$executeRaw`
      INSERT INTO "AnalyticsAnonTally" ("minute", "state", "signedIn", "releaseId", "beats", "playsStarted", "playMs")
      VALUES (${tally.minute}, ${tally.state}::"AnalyticsLiveState", ${tally.signedIn}, ${tally.releaseId},
              ${tally.beats}, ${tally.playsStarted}, ${tally.playMs}::bigint)
      ON CONFLICT ("minute", "state", "signedIn", "releaseId") DO UPDATE
      SET "beats" = "AnalyticsAnonTally"."beats" + EXCLUDED."beats",
          "playsStarted" = "AnalyticsAnonTally"."playsStarted" + EXCLUDED."playsStarted",
          "playMs" = "AnalyticsAnonTally"."playMs" + EXCLUDED."playMs"`;
  }

  private addOutcomes(tally: IngestTally): Prisma.PrismaPromise<number> {
    return this.prisma.$executeRaw`
      INSERT INTO "AnalyticsIngestStat" ("minute", "instanceId", "accepted", "rejected", "throttled", "writeErrors")
      VALUES (${tally.minute}, ${this.instanceId}, ${tally.accepted}, ${tally.rejected},
              ${tally.throttled}, ${tally.writeErrors})
      ON CONFLICT ("minute", "instanceId") DO UPDATE
      SET "accepted" = "AnalyticsIngestStat"."accepted" + EXCLUDED."accepted",
          "rejected" = "AnalyticsIngestStat"."rejected" + EXCLUDED."rejected",
          "throttled" = "AnalyticsIngestStat"."throttled" + EXCLUDED."throttled",
          "writeErrors" = "AnalyticsIngestStat"."writeErrors" + EXCLUDED."writeErrors"`;
  }

  private mergePings(key: string, tally: PingTally): void {
    const current = this.pings.get(key);
    if (!current) {
      this.pings.set(key, tally);
      return;
    }
    current.beats += tally.beats;
    current.playsStarted += tally.playsStarted;
    current.playMs += tally.playMs;
  }

  private mergeOutcomes(key: string, tally: IngestTally): void {
    const current = this.outcomes.get(key);
    if (!current) {
      this.outcomes.set(key, tally);
      return;
    }
    current.accepted += tally.accepted;
    current.rejected += tally.rejected;
    current.throttled += tally.throttled;
    current.writeErrors += tally.writeErrors;
  }
}
