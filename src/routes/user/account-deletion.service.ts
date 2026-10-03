import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { USER } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { PROFILE_ASSETS, ProfileAssetService } from './profile-asset.service';

/** Every relation of a user, the name the User model gives it. */
export type UserRelation = Exclude<keyof Prisma.UserInclude, '_count'>;

/**
 * What a deletion does to the rows each relation of the user reaches. A relation added to the
 * User model fails to compile here until its fate is decided, and the spec checks this list
 * against the schema; a fate other than `kept` has to be carried out below.
 *
 * - `deleted`: the rows go.
 * - `unlinked`: the rows stay, without the user among them.
 * - `ended`: the rows stay, closed.
 * - `kept`: the rows stay pointing at the anonymised user.
 */
export const USER_RELATION_FATES: Record<UserRelation, 'deleted' | 'unlinked' | 'ended' | 'kept'> =
  {
    friendsInitiated: 'deleted',
    friendsReceived: 'deleted',
    sentRequests: 'deleted',
    receivedRequests: 'deleted',
    refreshTokens: 'deleted',
    notifications: 'deleted',
    hostingSession: 'deleted',
    // Unpublished projects go, published ones only when the user asks.
    creator: 'deleted',
    collaborators: 'unlinked',
    workSession: 'unlinked',
    joinedGameSessions: 'unlinked',
    hostingGameSessions: 'ended',
    comments: 'kept',
    likes: 'kept',
    featuredReleases: 'kept',
  };

// Soft-deletes an account: the User row stays (so comments, likes and kept
// published games keep a valid author) but every identifying field is
// anonymised, sessions/tokens/social links are purged and the JWT strategy
// rejects the account from then on.
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectService: ProjectService,
    private readonly profileAssetService: ProfileAssetService,
  ) {}

  async deleteAccount(
    userId: number,
    removePublishedGames: boolean,
    password?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    if (
      user.password &&
      password !== undefined &&
      !(await bcrypt.compare(password, user.password))
    ) {
      throw new UnauthorizedException('Incorrect password');
    }

    await this.removeOwnedProjects(userId, removePublishedGames);
    await this.purgeAndAnonymise(userId);
    await this.removeProfileAssets(userId);

    this.logger.log(`Account ${userId} deleted`);
  }

  // Published games are kept unless the user asked otherwise; a project's live sessions go first
  // because their foreign keys block its delete.
  private async removeOwnedProjects(userId: number, removePublished: boolean): Promise<void> {
    const projects = await this.prisma.project.findMany({
      where: {
        userId,
        ...(removePublished ? {} : { publishedAt: null }),
      },
      select: { id: true },
    });

    for (const project of projects) {
      await this.prisma.$transaction([
        this.prisma.gameSession.deleteMany({ where: { projectId: project.id } }),
        this.prisma.workSession.deleteMany({ where: { projectId: project.id } }),
      ]);
      await this.projectService.remove(project.id);
    }
  }

  private async purgeAndAnonymise(userId: number): Promise<void> {
    const now = new Date();
    // The handle and the email are unique columns anyone may claim, so a tombstone that could be
    // guessed could be taken in advance and make this update fail.
    const tag = randomBytes(8).toString('hex');

    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.friendship.deleteMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
      }),
      this.prisma.friendRequest.deleteMany({
        where: { OR: [{ fromId: userId }, { toId: userId }] },
      }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.gameSession.updateMany({
        where: { hostId: userId, endedAt: null },
        data: { endedAt: now },
      }),
      // Collaborators recreate a work session on their next join.
      this.prisma.workSession.deleteMany({ where: { hostId: userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}-${tag}@deleted.naucto.invalid`,
          username: `deleted_${userId}_${tag}`,
          nickname: 'Deleted user',
          description: null,
          password: null,
          friendCode: null,
          deletedAt: now,
          role: USER,
          collaborators: { set: [] },
          workSession: { set: [] },
          joinedGameSessions: { set: [] },
        },
        select: { id: true },
      }),
    ]);
  }

  private async removeProfileAssets(userId: number): Promise<void> {
    for (const asset of PROFILE_ASSETS) {
      try {
        await this.profileAssetService.remove(userId, asset);
      } catch (error) {
        this.logger.warn(`Failed to delete the ${asset} image of user ${userId}: ${error}`);
      }
    }
  }
}
