import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';

import {
  ACTIVITY_CHANGED,
  ActivityChangedEvent,
  FRIENDSHIP_CHANGED,
  FriendshipChangedEvent,
  PROJECT_CHANGED,
  ProjectChangedEvent,
} from '../common/domain-events';
import { PrismaService } from '../prisma/prisma.service';
import { FriendsService } from '../routes/friends/friends.service';
import { MultiplayerService } from '../routes/multiplayer/multiplayer.service';
import { PresenceServerMessage } from './dto/presence-message.dto';
import {
  CLIENT_PRESENCE_KINDS,
  PresenceKind,
  PresenceSetInput,
  PresenceSocketHandler,
  PresenceState,
} from './presence.types';

type Entry = {
  connections: Map<number, PresenceSetInput>;
  generation: number;
  refreshedAt: number;
  // Null while the first derivation is in flight or after it failed: counted, not yet visible.
  state: PresenceState | null;
};

export type PresenceFanOut = (userId: number, message: PresenceServerMessage) => void;

export const PRESENCE_RESYNC_AFTER_MS = 2 * 60 * 1000;
export const PRESENCE_RESYNC_TICK_MS = 10 * 1000;
export const PRESENCE_RESYNC_MIN_BATCH = 100;
export const PRESENCE_RESYNC_MAX_BATCH = 2000;
export const PRESENCE_RESYNC_CONCURRENCY = 10;

export function presenceResyncBatch(online: number): number {
  const share = Math.ceil((online * PRESENCE_RESYNC_TICK_MS) / PRESENCE_RESYNC_AFTER_MS);
  return Math.min(PRESENCE_RESYNC_MAX_BATCH, Math.max(PRESENCE_RESYNC_MIN_BATCH, share));
}

function samePresence(a: PresenceState, b: PresenceState): boolean {
  return (Object.keys(a) as (keyof PresenceState)[]).every((key) => a[key] === b[key]);
}

// In-memory, single-process presence registry keyed by user id. A user is
// "online" while at least one authenticated notifications socket is open;
// activity is the latest one any of those sockets declared, with HOSTING /
// BUILDING derived from live game / work sessions so it cannot be spoofed.
@Injectable()
export class PresenceService implements PresenceSocketHandler {
  private readonly logger = new Logger(PresenceService.name);
  private readonly entries = new Map<number, Entry>();
  private fanOut: PresenceFanOut = () => undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly friendsService: FriendsService,
    private readonly multiplayerService: MultiplayerService,
  ) {}

  // Where a message for one user is delivered; nothing is sent until this is set.
  setFanOut(fanOut: PresenceFanOut): void {
    this.fanOut = fanOut;
  }

  async onSocketOpen(userId: number, connectionId: number): Promise<PresenceState[]> {
    const existing = this.entries.get(userId);

    if (existing) {
      existing.connections.set(connectionId, { kind: 'IDLE' });
    } else {
      // Counted before the first await, so a close or another open arriving meanwhile finds it.
      const entry: Entry = {
        connections: new Map([[connectionId, { kind: 'IDLE' }]]),
        generation: 0,
        refreshedAt: 0,
        state: null,
      };
      this.entries.set(userId, entry);
      await this.refresh(userId, entry);
    }

    return this.friendsPresence(userId);
  }

  async onSocketClose(userId: number, connectionId: number): Promise<void> {
    const entry = this.entries.get(userId);
    if (!entry?.connections.delete(connectionId)) {
      return;
    }

    if (entry.connections.size > 0) {
      await this.refresh(userId, entry);
      return;
    }

    this.entries.delete(userId);
    for (const friendId of await this.onlineFriendIds(userId)) {
      this.fanOut(friendId, { type: 'presence:offline', payload: { userId } });
    }
  }

  async onSet(userId: number, connectionId: number, input: PresenceSetInput): Promise<void> {
    const entry = this.entries.get(userId);
    if (!entry?.connections.has(connectionId)) {
      return;
    }

    entry.connections.delete(connectionId);
    entry.connections.set(connectionId, input);
    await this.refresh(userId, entry);
  }

  @OnEvent(ACTIVITY_CHANGED)
  async onActivityChanged({ userId }: ActivityChangedEvent): Promise<void> {
    const entry = this.entries.get(userId);
    if (!entry) {
      return;
    }

    await this.refresh(userId, entry);
  }

  @OnEvent(FRIENDSHIP_CHANGED)
  async onFriendshipChanged({ userId, otherId }: FriendshipChangedEvent): Promise<void> {
    const friends = await this.friendsService.areFriends(userId, otherId);

    for (const [viewerId, subjectId] of [
      [userId, otherId],
      [otherId, userId],
    ] as const) {
      const state = this.get(subjectId);
      this.fanOut(
        viewerId,
        friends && state
          ? { type: 'presence:changed', payload: state }
          : { type: 'presence:offline', payload: { userId: subjectId } },
      );
    }
  }

  @OnEvent(PROJECT_CHANGED)
  async onProjectChanged({ projectId }: ProjectChangedEvent): Promise<void> {
    await Promise.all(
      [...this.entries]
        .filter(
          ([, entry]) =>
            entry.state?.projectId === projectId || entry.state?.releaseId === projectId,
        )
        .map(([userId, entry]) => this.refresh(userId, entry)),
    );
  }

  @Interval(PRESENCE_RESYNC_TICK_MS)
  async resyncStale(): Promise<void> {
    const cutoff = Date.now() - PRESENCE_RESYNC_AFTER_MS;
    const stale = [...this.entries]
      .filter(([, entry]) => entry.refreshedAt <= cutoff)
      .sort(([, a], [, b]) => a.refreshedAt - b.refreshedAt)
      .slice(0, presenceResyncBatch(this.entries.size));

    for (let i = 0; i < stale.length; i += PRESENCE_RESYNC_CONCURRENCY) {
      await Promise.all(
        stale
          .slice(i, i + PRESENCE_RESYNC_CONCURRENCY)
          .map(([userId, entry]) =>
            this.refresh(userId, entry).catch((error) =>
              this.logger.warn(`presence resync failed for user ${userId}: ${error}`),
            ),
          ),
      );
    }
  }

  get(userId: number): PresenceState | null {
    return this.entries.get(userId)?.state ?? null;
  }

  /** How many accounts are online now in each state; one still being derived counts as idle. */
  countsByKind(): Record<PresenceKind, number> {
    const counts: Record<PresenceKind, number> = { IDLE: 0, PLAYING: 0, BUILDING: 0, HOSTING: 0 };
    for (const entry of this.entries.values()) {
      counts[entry.state?.kind ?? 'IDLE'] += 1;
    }
    return counts;
  }

  async friendsPresence(userId: number): Promise<PresenceState[]> {
    const friendIds = await this.friendsService.friendIdsOf(userId);

    return friendIds.map((friendId) => this.get(friendId)).filter((state) => state !== null);
  }

  async presenceOf(viewerId: number, userId: number): Promise<PresenceState> {
    const state = this.get(userId);

    // A stranger gets the answer an offline user gives, so the route does not tell who is online.
    if (
      state === null ||
      (viewerId !== userId && !(await this.friendsService.areFriends(viewerId, userId)))
    ) {
      throw new NotFoundException('User is offline');
    }

    return state;
  }

  private async refresh(userId: number, entry: Entry): Promise<void> {
    const generation = ++entry.generation;
    entry.refreshedAt = Date.now();
    const next = await this.derive(userId, this.latestDeclaration(entry));

    // The last socket may have closed, or a later refresh begun its own derivation, while the
    // queries ran; either way this result is stale.
    if (this.entries.get(userId) !== entry || entry.generation !== generation) {
      return;
    }

    const previous = entry.state;

    // Keep `since` when the activity itself did not change.
    if (
      previous &&
      previous.kind === next.kind &&
      previous.projectId === next.projectId &&
      previous.sessionId === next.sessionId &&
      previous.releaseId === next.releaseId
    ) {
      next.since = previous.since;
    }

    entry.state = next;
    if (previous && samePresence(previous, next)) {
      return;
    }

    for (const friendId of await this.onlineFriendIds(userId)) {
      this.fanOut(friendId, { type: 'presence:changed', payload: next });
    }
  }

  private latestDeclaration(entry: Entry): PresenceSetInput {
    return (
      [...entry.connections.values()].reverse().find((input) => input.kind === 'PLAYING') ?? {
        kind: 'IDLE',
      }
    );
  }

  // Builds the effective state: a live hosted game session wins, then a work
  // session the user is part of, then whatever the client declared.
  private async derive(userId: number, input: PresenceSetInput): Promise<PresenceState> {
    const who = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, nickname: true },
    });
    const base: PresenceState = {
      userId,
      username: who?.username ?? '',
      nickname: who?.nickname ?? null,
      kind: 'IDLE',
      releaseId: null,
      projectId: null,
      sessionId: null,
      title: null,
      coverUrl: null,
      players: null,
      maxPlayers: null,
      joinable: false,
      since: new Date().toISOString(),
    };

    return (
      (await this.hosting(base)) ??
      (await this.building(base)) ??
      (await this.declared(base, input))
    );
  }

  private async hosting(base: PresenceState): Promise<PresenceState | null> {
    const hosted = await this.multiplayerService.hostedSession(base.userId);

    if (!hosted) {
      return null;
    }

    return {
      ...base,
      kind: 'HOSTING',
      projectId: hosted.projectId,
      // A release shares its project's id; an unpublished project has none.
      releaseId: hosted.project.publishedAt ? hosted.projectId : null,
      sessionId: hosted.sessionId,
      title: hosted.title || hosted.project.name,
      coverUrl: hosted.project.iconUrl ?? null,
      players: hosted.players,
      maxPlayers: hosted.maxPlayers,
      // Presence is only shown to friends.
      joinable: hosted.openToFriends,
    };
  }

  private async building(base: PresenceState): Promise<PresenceState | null> {
    const building = await this.prisma.workSession.findFirst({
      where: { users: { some: { id: base.userId } } },
      orderBy: { lastActiveAt: 'desc' },
      select: {
        projectId: true,
        project: {
          select: { name: true, iconUrl: true, _count: { select: { collaborators: true } } },
        },
      },
    });

    if (!building) {
      return null;
    }

    return {
      ...base,
      kind: 'BUILDING',
      projectId: building.projectId,
      title: building.project.name,
      coverUrl: building.project.iconUrl ?? null,
      // Someone else is already on the project, so it is a shared build.
      joinable: building.project._count.collaborators > 0,
    };
  }

  private async declared(base: PresenceState, input: PresenceSetInput): Promise<PresenceState> {
    const kind = (CLIENT_PRESENCE_KINDS as readonly string[]).includes(input.kind)
      ? input.kind
      : 'IDLE';

    if (kind !== 'PLAYING') {
      return { ...base, kind };
    }

    const releaseId = input.releaseId ?? input.projectId ?? null;
    const played =
      releaseId === null
        ? null
        : await this.prisma.project.findFirst({
            where: { id: releaseId, publishedAt: { not: null } },
            select: { publishedName: true, name: true, iconUrl: true },
          });

    return {
      ...base,
      kind,
      releaseId,
      projectId: input.projectId ?? releaseId,
      title: played?.publishedName ?? played?.name ?? null,
      coverUrl: played?.iconUrl ?? null,
    };
  }

  private async onlineFriendIds(userId: number): Promise<number[]> {
    try {
      const friendIds = await this.friendsService.friendIdsOf(userId);
      return friendIds.filter((id) => this.entries.has(id));
    } catch (error) {
      this.logger.warn(`Failed to resolve friends of user ${userId}: ${error}`);
      return [];
    }
  }
}
