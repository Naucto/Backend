import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { NotificationsService } from '../../notifications/notifications.service';
import { isUniqueViolation, PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../user/user.service';
import {
  FriendDto,
  FriendRequestDto,
  FriendshipStatus,
  RecentPlayerDto,
  UserSummaryDto,
} from './dto/friend.dto';
import { SendFriendRequestDto } from './dto/send-friend-request.dto';

const USER_SUMMARY_SELECT = {
  id: true,
  username: true,
  nickname: true,
  deletedAt: true,
} as const;

type UserSummaryRow = Prisma.UserGetPayload<{ select: typeof USER_SUMMARY_SELECT }>;

export const DEFAULT_RECENT_PLAYERS_DAYS = 30;
const MAX_RECENT_PLAYERS_DAYS = 365;
const MAX_RECENT_PLAYERS = 50;
const MAX_RECENT_SESSIONS_SCANNED = 200;

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async areFriends(userId: number, otherId: number): Promise<boolean> {
    if (userId === otherId) {
      return false;
    }

    const friendship = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: this.canonicalPair(userId, otherId) },
      select: { id: true },
    });

    return friendship !== null;
  }

  async friendIdsOf(userId: number): Promise<number[]> {
    const friendships = await this.prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { userAId: true, userBId: true },
    });

    return friendships.map((friendship) =>
      friendship.userAId === userId ? friendship.userBId : friendship.userAId,
    );
  }

  async friendshipStatus(userId: number, otherId: number): Promise<FriendshipStatus> {
    if (await this.areFriends(userId, otherId)) {
      return 'FRIENDS';
    }

    const pending = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { fromId: userId, toId: otherId },
          { fromId: otherId, toId: userId },
        ],
      },
      select: { id: true },
    });

    return pending ? 'PENDING' : 'NONE';
  }

  async list(userId: number): Promise<FriendDto[]> {
    const friendships = await this.prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: {
        userA: { select: USER_SUMMARY_SELECT },
        userB: { select: USER_SUMMARY_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });

    const friends: FriendDto[] = [];

    for (const friendship of friendships) {
      const other = friendship.userAId === userId ? friendship.userB : friendship.userA;
      if (other.deletedAt) {
        continue;
      }

      friends.push({
        ...this.toSummary(other),
        since: friendship.createdAt.toISOString(),
      });
    }

    return friends;
  }

  async remove(userId: number, friendUserId: number): Promise<void> {
    if (userId === friendUserId) {
      throw new BadRequestException('Cannot unfriend yourself');
    }

    const result = await this.prisma.friendship.deleteMany({
      where: this.canonicalPair(userId, friendUserId),
    });

    if (result.count === 0) {
      throw new NotFoundException('Friendship not found');
    }
  }

  /** How many friends the user shares with each of `otherIds`, keyed by that id. */
  private async mutualFriendCounts(
    userId: number,
    otherIds: number[],
  ): Promise<Map<number, number>> {
    const [myFriendIds, theirFriendships] = await Promise.all([
      this.friendIdsOf(userId),
      this.prisma.friendship.findMany({
        where: {
          OR: [{ userAId: { in: otherIds } }, { userBId: { in: otherIds } }],
        },
        select: { userAId: true, userBId: true },
      }),
    ]);

    const friendsOf = new Map(otherIds.map((id) => [id, new Set<number>()]));
    for (const { userAId, userBId } of theirFriendships) {
      friendsOf.get(userAId)?.add(userBId);
      friendsOf.get(userBId)?.add(userAId);
    }

    const mine = new Set(myFriendIds);
    return new Map(
      [...friendsOf].map(([id, theirs]) => [
        id,
        [...theirs].filter((friendId) => mine.has(friendId)).length,
      ]),
    );
  }

  /** Those of `candidateIds` who joined or hosted a session of one of the user's games. */
  private async playedGamesOf(userId: number, candidateIds: number[]): Promise<Set<number>> {
    const players = await this.prisma.user.findMany({
      where: {
        id: { in: candidateIds },
        OR: [
          { hostingGameSessions: { some: { project: { userId } } } },
          { joinedGameSessions: { some: { project: { userId } } } },
        ],
      },
      select: { id: true },
    });

    return new Set(players.map((player) => player.id));
  }

  // Incoming and outgoing pending requests for the caller.
  async requests(userId: number): Promise<FriendRequestDto[]> {
    const requests = await this.prisma.friendRequest.findMany({
      where: { OR: [{ toId: userId }, { fromId: userId }] },
      include: {
        from: { select: USER_SUMMARY_SELECT },
        to: { select: USER_SUMMARY_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });

    const live = requests.filter((request) => !request.from.deletedAt && !request.to.deletedAt);
    const otherIds = live.map((request) =>
      request.fromId === userId ? request.toId : request.fromId,
    );
    const senderIds = live
      .filter((request) => request.toId === userId)
      .map((request) => request.fromId);

    const [mutuals, played] = await Promise.all([
      this.mutualFriendCounts(userId, otherIds),
      this.playedGamesOf(userId, senderIds),
    ]);

    return live.map((request) => {
      const incoming = request.toId === userId;

      return {
        id: request.id,
        from: this.toSummary(request.from),
        to: this.toSummary(request.to),
        createdAt: request.createdAt.toISOString(),
        mutuals: mutuals.get(incoming ? request.fromId : request.toId) ?? 0,
        // Only meaningful on incoming requests.
        ...(incoming ? { playedYourGame: played.has(request.fromId) } : {}),
      };
    });
  }

  async sendRequest(userId: number, dto: SendFriendRequestDto): Promise<FriendRequestDto | null> {
    const targetId = await this.resolveTarget(dto);

    if (targetId === userId) {
      throw new BadRequestException('Cannot send a friend request to yourself');
    }
    if (await this.areFriends(userId, targetId)) {
      throw new ConflictException('Already friends');
    }

    // A pending request in the other direction means both want it: accept it
    // instead of leaving two crossed requests.
    const reverse = await this.prisma.friendRequest.findUnique({
      where: { fromId_toId: { fromId: targetId, toId: userId } },
      select: { id: true },
    });
    if (reverse) {
      await this.accept(userId, reverse.id);
      return null;
    }

    const request = await this.prisma.friendRequest
      .create({
        data: { fromId: userId, toId: targetId },
        include: {
          from: { select: USER_SUMMARY_SELECT },
          to: { select: USER_SUMMARY_SELECT },
        },
      })
      .catch((error: unknown) => {
        // The pair is unique, so the insert itself is the check: reading first would leave two
        // concurrent sends both passing it.
        if (isUniqueViolation(error)) {
          throw new ConflictException('Friend request already sent');
        }
        throw error;
      });

    await this.notify(targetId, {
      title: 'New friend request',
      message: `${this.displayName(request.from)} wants to be your friend`,
      kind: 'FRIEND_REQUEST',
      data: { requestId: request.id, fromUserId: userId },
    });

    return {
      id: request.id,
      from: this.toSummary(request.from),
      to: this.toSummary(request.to),
      createdAt: request.createdAt.toISOString(),
    };
  }

  async accept(userId: number, requestId: number): Promise<void> {
    const request = await this.prisma.friendRequest.findFirst({
      where: { id: requestId, toId: userId },
      include: { to: { select: USER_SUMMARY_SELECT } },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // The request may have been cancelled or accepted since it was read above.
      const { count } = await tx.friendRequest.deleteMany({
        where: { id: request.id, toId: userId },
      });
      if (count === 0) {
        throw new NotFoundException('Friend request not found');
      }
      // Also drop a crossed request the other way, if any.
      await tx.friendRequest.deleteMany({
        where: { fromId: userId, toId: request.fromId },
      });

      // A failed insert would abort the whole transaction, so an existing friendship has to be
      // skipped by the statement rather than caught after it.
      await tx.friendship.createMany({
        data: [this.canonicalPair(userId, request.fromId)],
        skipDuplicates: true,
      });
    });

    await this.notify(request.fromId, {
      title: 'Friend request accepted',
      message: `${this.displayName(request.to)} accepted your friend request`,
      kind: 'FRIEND_ACCEPTED',
      data: { userId },
    });
  }

  // Declines an incoming request or cancels an outgoing one.
  async decline(userId: number, requestId: number): Promise<void> {
    const result = await this.prisma.friendRequest.deleteMany({
      where: { id: requestId, OR: [{ toId: userId }, { fromId: userId }] },
    });

    if (result.count === 0) {
      throw new NotFoundException('Friend request not found');
    }
  }

  // People the caller shared a game session with in the last `days` days, most
  // recent first, one entry per user.
  async recentPlayers(
    userId: number,
    days = DEFAULT_RECENT_PLAYERS_DAYS,
  ): Promise<RecentPlayerDto[]> {
    const window = Math.min(Math.max(days, 1), MAX_RECENT_PLAYERS_DAYS);
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

    const sessions = await this.prisma.gameSession.findMany({
      where: {
        startedAt: { gte: since },
        OR: [{ hostId: userId }, { otherUsers: { some: { id: userId } } }],
      },
      include: {
        host: { select: USER_SUMMARY_SELECT },
        otherUsers: { select: USER_SUMMARY_SELECT },
        project: { select: { name: true, publishedName: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: MAX_RECENT_SESSIONS_SCANNED,
    });

    const friendIds = new Set(await this.friendIdsOf(userId));
    const seen = new Map<number, RecentPlayerDto>();

    for (const session of sessions) {
      const participants = [session.host, ...session.otherUsers];

      for (const participant of participants) {
        if (participant.id === userId || participant.deletedAt || seen.has(participant.id)) {
          continue;
        }

        seen.set(participant.id, {
          ...this.toSummary(participant),
          game: session.project.publishedName || session.project.name,
          playedAt: session.startedAt.toISOString(),
          friend: friendIds.has(participant.id),
        });

        if (seen.size >= MAX_RECENT_PLAYERS) {
          return [...seen.values()];
        }
      }
    }

    return [...seen.values()];
  }

  private canonicalPair(userId: number, otherId: number): { userAId: number; userBId: number } {
    return userId < otherId
      ? { userAId: userId, userBId: otherId }
      : { userAId: otherId, userBId: userId };
  }

  private async resolveTarget(dto: SendFriendRequestDto): Promise<number> {
    if (dto.userId !== undefined) {
      const user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { id: true, deletedAt: true },
      });
      if (!user || user.deletedAt) {
        throw new NotFoundException('User not found');
      }
      return user.id;
    }

    if (dto.username !== undefined) {
      const user = await this.prisma.user.findUnique({
        where: { username: dto.username },
        select: { id: true, deletedAt: true },
      });
      if (!user || user.deletedAt) {
        throw new NotFoundException('No user with this handle');
      }
      return user.id;
    }

    if (dto.friendCode !== undefined) {
      const id = await this.userService.findIdByFriendCode(dto.friendCode);
      if (id === null) {
        throw new NotFoundException('No user with this friend code');
      }
      return id;
    }

    throw new BadRequestException('userId, username or friendCode is required');
  }

  private async notify(
    userId: number,
    input: {
      title: string;
      message: string;
      kind: 'FRIEND_REQUEST' | 'FRIEND_ACCEPTED';
      data: Record<string, number>;
    },
  ): Promise<void> {
    await this.notificationsService.notifyBestEffort({ userId, type: 'INFO', ...input });
  }

  private toSummary(user: UserSummaryRow): UserSummaryDto {
    return { id: user.id, username: user.username, nickname: user.nickname };
  }

  private displayName(user: UserSummaryRow): string {
    return user.nickname ?? user.username;
  }
}
