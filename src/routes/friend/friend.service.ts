import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { CloudfrontService } from "@s3/edge.service";
import { NotificationsService } from "src/notifications/notifications.service";
import {
  AlreadyFriendsError,
  CannotFriendYourselfError,
  FriendRequestAlreadyExistsError,
  FriendRequestNotFoundError,
  FriendshipNotFoundError,
  UnauthorizedFriendActionError,
} from "./friend.error";
import { FriendResponseDto, FriendUserInfoDto } from "./dto/friend-response.dto";
import { FriendRequestResponseDto } from "./dto/friend-request-response.dto";
import type { FriendshipStatus } from "./dto/friendship-status-response.dto";

type FriendUserRaw = {
  id: number;
  username: string;
  nickname: string | null;
};

type FriendshipRaw = {
  id: number;
  userA: FriendUserRaw;
  userB: FriendUserRaw;
  createdAt: Date;
};

type FriendRequestRaw = {
  id: number;
  from: FriendUserRaw;
  to: FriendUserRaw;
  createdAt: Date;
};

export type FriendshipStatusRaw = {
  status: FriendshipStatus;
  requestId: number | null;
  friendshipId: number | null;
};

const USER_SELECT = { id: true, username: true, nickname: true } as const;

@Injectable()
export class FriendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly cloudfrontService: CloudfrontService,
  ) {}

  private async enrichUser(user: FriendUserRaw): Promise<FriendUserInfoDto> {
    const profileImageUrl = await this.cloudfrontService.getVersionedCDNUrl(`users/${user.id}/profile`);
    return { ...user, profileImageUrl };
  }

  private async enrichRequest(request: FriendRequestRaw): Promise<FriendRequestResponseDto> {
    const [from, to] = await Promise.all([this.enrichUser(request.from), this.enrichUser(request.to)]);
    return { id: request.id, from, to, createdAt: request.createdAt.toISOString() };
  }

  private async enrichFriendship(friendship: FriendshipRaw, forUserId: number): Promise<FriendResponseDto> {
    const otherUser = friendship.userA.id === forUserId ? friendship.userB : friendship.userA;
    const user = await this.enrichUser(otherUser);
    return { friendshipId: friendship.id, user, since: friendship.createdAt.toISOString() };
  }

  async sendRequest(fromId: number, toId: number): Promise<FriendRequestResponseDto> {
    if (fromId === toId) {
      throw new CannotFriendYourselfError("Cannot send a friend request to yourself");
    }

    const [existing, existingReverse, friendship] = await Promise.all([
      this.prisma.friendRequest.findUnique({ where: { fromId_toId: { fromId, toId } } }),
      this.prisma.friendRequest.findUnique({ where: { fromId_toId: { fromId: toId, toId: fromId } } }),
      this.findFriendship(fromId, toId),
    ]);

    if (friendship) {
      throw new AlreadyFriendsError("You are already friends with this user");
    }
    if (existing !== null || existingReverse !== null) {
      throw new FriendRequestAlreadyExistsError("A friend request already exists between these users");
    }

    const toUser = await this.prisma.user.findUnique({ where: { id: toId }, select: { id: true, username: true } });
    if (!toUser) {
      throw new NotFoundException(`User with ID ${toId} not found`);
    }

    const request = await this.prisma.friendRequest.create({
      data: { fromId, toId },
      select: {
        id: true,
        createdAt: true,
        from: { select: USER_SELECT },
        to: { select: USER_SELECT },
      },
    });

    await this.notificationsService.createNotification({
      userId: toId,
      title: "New friend request",
      message: `${request.from.username} sent you a friend request.`,
      type: "INFO",
      metadata: { requestId: request.id },
    });

    return this.enrichRequest(request);
  }

  async cancelOrRejectRequest(requestId: number, userId: number): Promise<void> {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
      select: { id: true, fromId: true, toId: true },
    });

    if (!request) {
      throw new FriendRequestNotFoundError(`Friend request ${requestId} not found`);
    }
    if (request.fromId !== userId && request.toId !== userId) {
      throw new UnauthorizedFriendActionError("You are not part of this friend request");
    }

    await this.prisma.friendRequest.delete({ where: { id: requestId } });
  }

  async acceptRequest(requestId: number, userId: number): Promise<void> {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
      select: { id: true, fromId: true, toId: true, from: { select: USER_SELECT } },
    });

    if (!request) {
      throw new FriendRequestNotFoundError(`Friend request ${requestId} not found`);
    }
    if (request.toId !== userId) {
      throw new UnauthorizedFriendActionError("Only the recipient can accept a friend request");
    }

    const userAId = Math.min(request.fromId, request.toId);
    const userBId = Math.max(request.fromId, request.toId);

    await this.prisma.$transaction([
      this.prisma.friendship.create({
        data: { userAId, userBId },
        select: {
          id: true,
          createdAt: true,
          userA: { select: USER_SELECT },
          userB: { select: USER_SELECT },
        },
      }),
      this.prisma.friendRequest.delete({ where: { id: requestId } }),
    ]);

    const toUser = await this.prisma.user.findUnique({ where: { id: request.toId }, select: { id: true, username: true } });
    if (!toUser) {
      throw new NotFoundException(`User with ID ${request.toId} not found`);
    }
    await this.notificationsService.createNotification({
      userId: request.fromId,
      title: "Friend request accepted",
      message: `${toUser.username} accepted your friend request.`,
      type: "INFO",
    });

  }

  async getMyFriends(userId: number): Promise<FriendResponseDto[]> {
    const friendships = await this.prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: {
        id: true,
        createdAt: true,
        userA: { select: USER_SELECT },
        userB: { select: USER_SELECT },
      },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(friendships.map((f) => this.enrichFriendship(f, userId)));
  }

  async getReceivedRequests(userId: number): Promise<FriendRequestResponseDto[]> {
    const requests = await this.prisma.friendRequest.findMany({
      where: { toId: userId },
      select: {
        id: true,
        createdAt: true,
        from: { select: USER_SELECT },
        to: { select: USER_SELECT },
      },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(requests.map((r) => this.enrichRequest(r)));
  }

  async getSentRequests(userId: number): Promise<FriendRequestResponseDto[]> {
    const requests = await this.prisma.friendRequest.findMany({
      where: { fromId: userId },
      select: {
        id: true,
        createdAt: true,
        from: { select: USER_SELECT },
        to: { select: USER_SELECT },
      },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(requests.map((r) => this.enrichRequest(r)));
  }

  async removeFriend(userId: number, friendId: number): Promise<void> {
    const friendship = await this.findFriendship(userId, friendId);
    if (!friendship) {
      throw new FriendshipNotFoundError(`No friendship found between users ${userId} and ${friendId}`);
    }

    await this.prisma.friendship.delete({ where: { id: friendship.id } });
  }

  async getFriendshipStatus(userId: number, targetId: number): Promise<FriendshipStatusRaw> {
    const [friendship, sentRequest, receivedRequest] = await Promise.all([
      this.findFriendship(userId, targetId),
      this.prisma.friendRequest.findUnique({ where: { fromId_toId: { fromId: userId, toId: targetId } } }),
      this.prisma.friendRequest.findUnique({ where: { fromId_toId: { fromId: targetId, toId: userId } } }),
    ]);

    if (friendship) {
      return { status: "FRIENDS", requestId: null, friendshipId: friendship.id };
    }
    if (sentRequest) {
      return { status: "REQUEST_SENT", requestId: sentRequest.id, friendshipId: null };
    }
    if (receivedRequest) {
      return { status: "REQUEST_RECEIVED", requestId: receivedRequest.id, friendshipId: null };
    }

    return { status: "NONE", requestId: null, friendshipId: null };
  }

  async countFriends(userId: number): Promise<number> {
    return this.prisma.friendship.count({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
    });
  }

  async areFriends(userAId: number, userBId: number): Promise<boolean> {
    const friendship = await this.findFriendship(userAId, userBId);
    return friendship !== null;
  }

  private async findFriendship(userAId: number, userBId: number): Promise<{ id: number } | null> {
    const minId = Math.min(userAId, userBId);
    const maxId = Math.max(userAId, userBId);
    return this.prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId: minId, userBId: maxId } },
      select: { id: true },
    });
  }
}

