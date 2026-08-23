import { Injectable } from "@nestjs/common";
import {
  ModerationAction,
  ModerationActionType,
  Prisma
} from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { Actor } from "@auth/actor";
import { ModeratableRef, refKey } from "./moderatable";

export type AuditRecordInput = {
  ref: ModeratableRef;
  actor: Actor | number | null;
  action: ModerationActionType;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  reportId?: number | null;
};

export type AuditEntry = ModerationAction & {
  actor: { id: number; username: string } | null;
};

/** Why a thing is in its current moderation state, and who put it there. */
export type ModerationState = {
  action: ModerationActionType;
  reason: string | null;
  at: Date;
  byId: number | null;
  byLabel: string | null;
};

/** Only the newest entry matters for current state. */
const HIDE_LOOKBACK = 1;

/**
 * Moderation history for any moderatable thing.
 *
 * Hand it a project and you get the project's log; hand it a comment and you
 * get the comment's. Callers never build a `targetType`/`targetId` pair by
 * hand, which is what previously made every entity need its own bespoke
 * plumbing.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    await this.prisma.moderationAction.create({
      data: {
        actorId: this.actorId(input.actor),
        targetType: input.ref.type,
        targetId: input.ref.id,
        action: input.action,
        reason: input.reason ?? null,
        before: this.toJson(input.before),
        after: this.toJson(input.after),
        reportId: input.reportId ?? null
      }
    });
  }

  /** Full history for one thing, newest first. */
  async historyOf(
    ref: ModeratableRef,
    options: { skip?: number; take?: number } = {}
  ): Promise<AuditEntry[]> {
    return this.prisma.moderationAction.findMany({
      where: { targetType: ref.type, targetId: ref.id },
      orderBy: { createdAt: "desc" },
      ...(options.skip !== undefined ? { skip: options.skip } : {}),
      ...(options.take !== undefined ? { take: options.take } : {}),
      include: { actor: { select: { id: true, username: true } } }
    });
  }

  async countFor(ref: ModeratableRef): Promise<number> {
    return this.prisma.moderationAction.count({
      where: { targetType: ref.type, targetId: ref.id }
    });
  }

  /** The most recent action taken on one thing, or null if it was never touched. */
  async lastActionOn(ref: ModeratableRef): Promise<AuditEntry | null> {
    const [entry] = await this.historyOf(ref, { take: 1 });

    return entry ?? null;
  }

  /**
   * Batch version of {@link lastActionOn}, keyed by `type:id`.
   *
   * Listings need the latest action per row; without this they would issue one
   * query per row.
   */
  async lastActionsOn(
    refs: readonly ModeratableRef[]
  ): Promise<Map<string, AuditEntry>> {
    if (refs.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.moderationAction.findMany({
      where: {
        OR: refs.map((ref) => ({ targetType: ref.type, targetId: ref.id }))
      },
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { id: true, username: true } } }
    });

    const latest = new Map<string, AuditEntry>();
    for (const row of rows) {
      const key = refKey({ type: row.targetType, id: row.targetId });
      // Rows arrive newest-first, so the first hit for a key is the latest.
      if (!latest.has(key)) {
        latest.set(key, row);
      }
    }

    return latest;
  }

  /**
   * The moderation state of a thing, derived from its log.
   *
   * Replaces the per-entity `hiddenReason`/`hiddenAt`/`hiddenById` columns: the
   * log already records who hid it, when and why, so storing the same three
   * facts again on every moderatable table was duplication that could drift.
   * `hidden` stays a real column because listings filter on it.
   */
  async moderationStateOf(ref: ModeratableRef): Promise<ModerationState | null> {
    const [entry] = await this.historyOf(ref, { take: HIDE_LOOKBACK });

    return entry ? this.toState(entry) : null;
  }

  /** Batch counterpart, keyed by `type:id`, for listings. */
  async moderationStatesOf(
    refs: readonly ModeratableRef[]
  ): Promise<Map<string, ModerationState>> {
    const latest = await this.lastActionsOn(refs);
    const states = new Map<string, ModerationState>();

    for (const [key, entry] of latest) {
      states.set(key, this.toState(entry));
    }

    return states;
  }

  private toState(entry: AuditEntry): ModerationState {
    return {
      action: entry.action,
      reason: entry.reason,
      at: entry.createdAt,
      byId: entry.actorId,
      byLabel: entry.actor?.username ? `@${entry.actor.username}` : null
    };
  }

  private actorId(actor: Actor | number | null): number | null {
    if (actor === null) return null;

    return typeof actor === "number" ? actor : actor.id;
  }

  private toJson(
    value: unknown
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return value === undefined || value === null
      ? Prisma.JsonNull
      : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
  }
}
