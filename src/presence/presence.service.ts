import { Injectable, Logger } from "@nestjs/common";
import { GameSessionVisibility } from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { FriendsService } from "@friends/friends.service";
import {
  CLIENT_PRESENCE_KINDS,
  PresenceServerMessage,
  PresenceSetInput,
  PresenceSocketHandler,
  PresenceState
} from "./presence.types";

type Entry = {
  sockets: number;
  state: PresenceState;
};

export type PresenceFanOut = (userId: number, message: PresenceServerMessage) => void;

// In-memory, single-process presence registry keyed by user id. A user is
// "online" while at least one authenticated notifications socket is open
// (refcount); activity is what the client last declared, with HOSTING /
// BUILDING derived from live game / work sessions so it cannot be spoofed.
@Injectable()
export class PresenceService implements PresenceSocketHandler {
  private readonly logger = new Logger(PresenceService.name);
  private readonly entries = new Map<number, Entry>();
  private fanOut: PresenceFanOut = () => undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly friendsService: FriendsService
  ) {}

  // Wired by the notifications websocket server so changes reach friends'
  // sockets without this module depending on it.
  setFanOut(fanOut: PresenceFanOut): void {
    this.fanOut = fanOut;
  }

  // --------------------------------------------------------------------------
  // Socket lifecycle
  // --------------------------------------------------------------------------

  async onSocketOpen(userId: number): Promise<PresenceState[]> {
    const existing = this.entries.get(userId);

    if (existing) {
      existing.sockets += 1;
    } else {
      this.entries.set(userId, {
        sockets: 1,
        state: await this.derive(userId, { kind: "IDLE" })
      });
      await this.broadcast(userId);
    }

    return this.friendsPresence(userId);
  }

  async onSocketClose(userId: number): Promise<void> {
    const entry = this.entries.get(userId);
    if (!entry) {
      return;
    }

    entry.sockets -= 1;
    if (entry.sockets > 0) {
      return;
    }

    this.entries.delete(userId);
    await this.broadcastOffline(userId);
  }

  async onSet(userId: number, input: PresenceSetInput): Promise<void> {
    const entry = this.entries.get(userId);
    if (!entry) {
      return;
    }

    const next = await this.derive(userId, input);
    const previous = entry.state;

    // Keep `since` when the activity itself did not change.
    if (
      previous.kind === next.kind &&
      previous.projectId === next.projectId &&
      previous.sessionId === next.sessionId &&
      previous.releaseId === next.releaseId
    ) {
      next.since = previous.since;
    }

    entry.state = next;
    await this.broadcast(userId);
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  isOnline(userId: number): boolean {
    return this.entries.has(userId);
  }

  get(userId: number): PresenceState | null {
    return this.entries.get(userId)?.state ?? null;
  }

  // Presence of the caller's online friends, with `joinable` evaluated from
  // the caller's point of view.
  async friendsPresence(userId: number): Promise<PresenceState[]> {
    const friendIds = await this.friendsService.friendIdsOf(userId);

    return friendIds
      .map((friendId) => this.entries.get(friendId)?.state)
      .filter((state): state is PresenceState => state !== undefined)
      .map((state) => this.forViewer(state, true));
  }

  async presenceOf(viewerId: number, userId: number): Promise<PresenceState | null> {
    const state = this.get(userId);
    if (!state) {
      return null;
    }

    const friends =
      viewerId === userId || (await this.friendsService.areFriends(viewerId, userId));

    return this.forViewer(state, friends);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  // Builds the effective state: a live hosted game session wins, then a work
  // session the user is part of, then whatever the client declared.
  private async derive(userId: number, input: PresenceSetInput): Promise<PresenceState> {
    const since = new Date().toISOString();
    const who = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, nickname: true }
    });
    const base: PresenceState = {
      userId,
      username: who?.username ?? "",
      nickname: who?.nickname ?? null,
      kind: "IDLE",
      releaseId: null,
      projectId: null,
      sessionId: null,
      title: null,
      coverUrl: null,
      players: null,
      maxPlayers: null,
      joinable: false,
      since
    };

    const hosted = await this.prisma.gameSession.findFirst({
      where: { hostId: userId, endedAt: null },
      orderBy: { startedAt: "desc" },
      select: {
        sessionId: true,
        projectId: true,
        title: true,
        maxPlayers: true,
        visibility: true,
        project: { select: { publishedAt: true, iconUrl: true, name: true } },
        _count: { select: { otherUsers: true } }
      }
    });
    if (hosted) {
      return {
        ...base,
        kind: "HOSTING",
        projectId: hosted.projectId,
        // A published project plays at /play/<projectId>; unpublished ones have no release to link.
        releaseId: hosted.project.publishedAt ? hosted.projectId : null,
        sessionId: hosted.sessionId,
        title: hosted.title || hosted.project.name,
        coverUrl: hosted.project.iconUrl ?? null,
        players: hosted._count.otherUsers + 1,
        maxPlayers: hosted.maxPlayers,
        // INVITE_CODE sessions are never joinable from presence; FRIENDS_ONLY
        // is narrowed per viewer in forViewer().
        joinable: hosted.visibility !== GameSessionVisibility.INVITE_CODE
      };
    }

    const building = await this.prisma.workSession.findFirst({
      where: { users: { some: { id: userId } } },
      orderBy: { lastActiveAt: "desc" },
      select: {
        projectId: true,
        project: {
          select: { name: true, iconUrl: true, _count: { select: { collaborators: true } } }
        }
      }
    });
    if (building) {
      return {
        ...base,
        kind: "BUILDING",
        projectId: building.projectId,
        title: building.project.name,
        coverUrl: building.project.iconUrl ?? null,
        // "open to collaborators": someone else is already on the project, so it is a shared build.
        joinable: building.project._count.collaborators > 0
      };
    }

    const kind = (CLIENT_PRESENCE_KINDS as readonly string[]).includes(input.kind)
      ? input.kind
      : "IDLE";

    if (kind !== "PLAYING") {
      return { ...base, kind };
    }

    const releaseId = input.releaseId ?? input.projectId ?? null;
    const played =
      releaseId === null
        ? null
        : await this.prisma.project.findFirst({
          where: { id: releaseId, publishedAt: { not: null } },
          select: { publishedName: true, name: true, iconUrl: true }
        });

    return {
      ...base,
      kind,
      releaseId,
      projectId: input.projectId ?? releaseId,
      // Without this the row reads "playing " with nothing after it.
      title: played?.publishedName ?? played?.name ?? null,
      coverUrl: played?.iconUrl ?? null
    };
  }

  private forViewer(state: PresenceState, isFriend: boolean): PresenceState {
    if (state.kind !== "HOSTING") {
      return state;
    }
    return { ...state, joinable: state.joinable && isFriend };
  }

  private async broadcast(userId: number): Promise<void> {
    const state = this.get(userId);
    if (!state) {
      return;
    }

    for (const friendId of await this.onlineFriendIds(userId)) {
      this.fanOut(friendId, {
        type: "presence:changed",
        payload: this.forViewer(state, true)
      });
    }
  }

  private async broadcastOffline(userId: number): Promise<void> {
    for (const friendId of await this.onlineFriendIds(userId)) {
      this.fanOut(friendId, { type: "presence:offline", payload: { userId } });
    }
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
