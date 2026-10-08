import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { SyncedGameTableObserver } from '../../webrtc/server/webrtc.server.synced-game-table';

const CHECKPOINT_INTERVAL_MS = 60_000;

interface RoomTally {
  /** Seat id to the time it connected, for the seats connected now. */
  connected: Map<number, number>;
  /** Seat id to the random token its seat row is stored under; never persisted with the seat id. */
  tokens: Map<number, string>;
  /** Totals reached by seats and multiplayer stretches that are over. */
  closedPlayerMs: number;
  closedMultiMs: number;
  /** Start of the current stretch with two or more seats connected. */
  multiSince: number | null;
  peak: number;
  /** Every write of a room runs after the previous one, so its checkpoints never interleave. */
  queue: Promise<void>;
}

/** The UTC day of an instant, as a `YYYY-MM-DD` date. */
const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

/**
 * Turns what the game rooms see into durable multiplayer analytics: rooms, the seats that
 * connected, and connected time, kept apart from GameSession so deleting a project leaves them.
 * Progress is written as cumulative totals that only grow, so a checkpoint retried after an
 * unknown outcome credits nothing twice.
 */
@Injectable()
export class MultiplayerAccountingService implements SyncedGameTableObserver {
  private readonly logger = new Logger(MultiplayerAccountingService.name);
  private readonly rooms = new Map<string, RoomTally>();
  /** The final writes of rooms already forgotten, until they have run. */
  private readonly closing = new Set<Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Records a room the API created, classified as an editor test when the editor asked. */
  async roomCreated(sessionId: string, projectId: number, editorTest: boolean): Promise<void> {
    try {
      await this.prisma.analyticsMpSession.createMany({
        data: [{ id: sessionId, projectId, editorTest }],
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.warn(`Failed to record room ${sessionId}: ${String(error)}`);
    }
  }

  /** An editor self-join only reclassifies a room no seat has connected to yet. */
  async editorJoined(sessionId: string): Promise<void> {
    const changed = await this.prisma.analyticsMpSession.updateMany({
      where: { id: sessionId, classifiedAt: null },
      data: { editorTest: true },
    });
    if (changed.count === 0) {
      this.logger.log(`Room ${sessionId} was already classified; its editor join is ignored`);
    }
  }

  seatConnected(sessionId: string, seatId: number, now = Date.now()): void {
    const room = this.tallyOf(sessionId);
    const firstConnection = room.connected.size === 0 && room.peak === 0;
    if (!room.connected.has(seatId)) {
      room.connected.set(seatId, now);
    }
    if (room.connected.size >= 2 && room.multiSince === null) {
      room.multiSince = now;
    }
    room.peak = Math.max(room.peak, room.connected.size);

    let seatToken = room.tokens.get(seatId);
    const newSeat = seatToken === undefined;
    seatToken ??= randomUUID();
    room.tokens.set(seatId, seatToken);

    const connected = room.connected.size;
    const token = seatToken;
    this.enqueue(sessionId, room, async () => {
      if (firstConnection) {
        await this.classifyAtFirstConnection(sessionId, now);
      }
      if (newSeat) {
        await this.prisma.analyticsMpSeat.createMany({
          data: [{ sessionId, seatToken: token, firstConnectedAt: new Date(now) }],
          skipDuplicates: true,
        });
      }
      await this.prisma.$executeRaw`
        UPDATE "AnalyticsMpSession"
        SET "peakConnected" = GREATEST("peakConnected", ${connected}::int),
            "reachedMultiAt" = CASE
              WHEN ${connected}::int >= 2 THEN COALESCE("reachedMultiAt", ${new Date(now)})
              ELSE "reachedMultiAt"
            END
        WHERE id = ${sessionId}::uuid`;
    });
  }

  seatDisconnected(sessionId: string, seatId: number, now = Date.now()): void {
    const room = this.rooms.get(sessionId);
    const since = room?.connected.get(seatId);
    if (!room || since === undefined) {
      return;
    }
    room.closedPlayerMs += now - since;
    room.connected.delete(seatId);
    if (room.connected.size < 2 && room.multiSince !== null) {
      room.closedMultiMs += now - room.multiSince;
      room.multiSince = null;
    }
  }

  /** The room is gone from the game server: writes its last totals and forgets it. */
  roomClosed(sessionId: string, now = Date.now()): void {
    const room = this.rooms.get(sessionId);
    if (!room) {
      return;
    }
    for (const seatId of [...room.connected.keys()]) {
      this.seatDisconnected(sessionId, seatId, now);
    }
    this.enqueue(sessionId, room, () => this.checkpoint(sessionId, room, now));
    this.rooms.delete(sessionId);
    const last = room.queue;
    this.closing.add(last);
    void last.then(() => this.closing.delete(last));
  }

  /** The session ended in the API; repeated calls leave the first end time. */
  async sessionEnded(sessionId: string, now = Date.now()): Promise<void> {
    this.roomClosed(sessionId, now);
    try {
      await this.prisma.analyticsMpSession.updateMany({
        where: { id: sessionId, endedAt: null },
        data: { endedAt: new Date(now) },
      });
    } catch (error) {
      this.logger.warn(`Failed to end room ${sessionId}: ${String(error)}`);
    }
  }

  @Interval(CHECKPOINT_INTERVAL_MS)
  checkpointAll(now = Date.now()): void {
    for (const [sessionId, room] of this.rooms) {
      this.enqueue(sessionId, room, () => this.checkpoint(sessionId, room, now));
    }
  }

  /** Resolves once every write queued so far has run; for tests and shutdown. */
  async settled(): Promise<void> {
    await Promise.all([...[...this.rooms.values()].map((room) => room.queue), ...this.closing]);
  }

  private tallyOf(sessionId: string): RoomTally {
    let room = this.rooms.get(sessionId);
    if (!room) {
      room = {
        connected: new Map(),
        tokens: new Map(),
        closedPlayerMs: 0,
        closedMultiMs: 0,
        multiSince: null,
        peak: 0,
        queue: Promise.resolve(),
      };
      this.rooms.set(sessionId, room);
      // A room the server re-forms (after a restart) resumes from what it already wrote.
      const resumed = room;
      this.enqueue(sessionId, room, async () => {
        const stored = await this.prisma.analyticsMpSession.findUnique({
          where: { id: sessionId },
          select: { multiMs: true, playerMs: true, peakConnected: true },
        });
        if (stored) {
          resumed.closedMultiMs += Number(stored.multiMs);
          resumed.closedPlayerMs += Number(stored.playerMs);
          resumed.peak = Math.max(resumed.peak, stored.peakConnected);
        }
      });
    }
    return room;
  }

  private async classifyAtFirstConnection(sessionId: string, now: number): Promise<void> {
    // A room the API never recorded (its insert failed) is still accounted, as a real game.
    const session = await this.prisma.gameSession.findUnique({
      where: { sessionId },
      select: { projectId: true },
    });
    if (session) {
      await this.prisma.analyticsMpSession.createMany({
        data: [{ id: sessionId, projectId: session.projectId, editorTest: false }],
        skipDuplicates: true,
      });
    }
    await this.prisma.analyticsMpSession.updateMany({
      where: { id: sessionId, classifiedAt: null },
      data: { classifiedAt: new Date(now), firstConnectedAt: new Date(now) },
    });
  }

  private async checkpoint(sessionId: string, room: RoomTally, now: number): Promise<void> {
    let playerMs = room.closedPlayerMs;
    for (const since of room.connected.values()) {
      playerMs += now - since;
    }
    const multiMs = room.closedMultiMs + (room.multiSince === null ? 0 : now - room.multiSince);

    await this.prisma.$transaction(async (tx) => {
      const [stored] = await tx.$queryRaw<{ multiMs: bigint; playerMs: bigint }[]>`
        SELECT "multiMs", "playerMs" FROM "AnalyticsMpSession" WHERE id = ${sessionId}::uuid FOR UPDATE`;
      if (!stored) {
        return;
      }
      const multiDelta = Math.max(0, multiMs - Number(stored.multiMs));
      const playerDelta = Math.max(0, playerMs - Number(stored.playerMs));
      if (multiDelta === 0 && playerDelta === 0) {
        return;
      }
      await tx.analyticsMpSession.update({
        where: { id: sessionId },
        data: {
          multiMs: BigInt(Number(stored.multiMs) + multiDelta),
          playerMs: BigInt(Number(stored.playerMs) + playerDelta),
        },
      });
      const day = utcDay(now);
      await tx.$executeRaw`
        INSERT INTO "AnalyticsMpDay" ("sessionId", "day", "multiMs", "playerMs")
        VALUES (${sessionId}::uuid, ${day}::date, ${multiDelta}::bigint, ${playerDelta}::bigint)
        ON CONFLICT ("sessionId", "day") DO UPDATE
        SET "multiMs" = "AnalyticsMpDay"."multiMs" + EXCLUDED."multiMs",
            "playerMs" = "AnalyticsMpDay"."playerMs" + EXCLUDED."playerMs"`;
    });
  }

  private enqueue(sessionId: string, room: RoomTally, write: () => Promise<void>): void {
    room.queue = room.queue.then(write).catch((error: unknown) => {
      this.logger.warn(`Multiplayer analytics write for ${sessionId} failed: ${String(error)}`);
    });
  }
}
