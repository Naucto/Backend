import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ProjectService } from "@project/project.service";
import { S3Service } from "@s3/s3.service";
import { profileAssetKey } from "./profile-asset";

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
    private readonly s3Service: S3Service
  ) {}

  async deleteAccount(
    userId: number,
    removePublishedGames: boolean,
    password?: string
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, deletedAt: true }
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException("User not found");
    }

    if (
      user.password &&
      password !== undefined &&
      !(await bcrypt.compare(password, user.password))
    ) {
      throw new UnauthorizedException("Incorrect password");
    }

    await this.removeOwnedProjects(userId, removePublishedGames);
    await this.purgeAndAnonymise(userId);
    await this.removeProfileAssets(userId);

    this.logger.log(`Account ${userId} deleted`);
  }

  // Published games are kept unless the user asked otherwise; a project's live sessions go first
  // because their foreign keys block its delete.
  private async removeOwnedProjects(
    userId: number,
    removePublished: boolean
  ): Promise<void> {
    const projects = await this.prisma.project.findMany({
      where: {
        userId,
        ...(removePublished ? {} : { publishedAt: null })
      },
      select: { id: true }
    });

    for (const project of projects) {
      await this.prisma.$transaction([
        this.prisma.gameSession.deleteMany({ where: { projectId: project.id } }),
        this.prisma.workSession.deleteMany({ where: { projectId: project.id } })
      ]);
      await this.projectService.remove(project.id);
    }
  }

  private async purgeAndAnonymise(userId: number): Promise<void> {
    const now = new Date();
    // The handle and the email are unique columns anyone may claim, so a tombstone that could be
    // guessed could be taken in advance and make this update fail.
    const tag = randomBytes(8).toString("hex");

    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.friendship.deleteMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] }
      }),
      this.prisma.friendRequest.deleteMany({
        where: { OR: [{ fromId: userId }, { toId: userId }] }
      }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.gameSession.updateMany({
        where: { hostId: userId, endedAt: null },
        data: { endedAt: now }
      }),
      // Collaborators recreate a work session on their next join.
      this.prisma.workSession.deleteMany({ where: { hostId: userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}-${tag}@deleted.naucto.invalid`,
          username: `deleted_${userId}_${tag}`,
          nickname: "Deleted user",
          description: null,
          password: null,
          friendCode: null,
          deletedAt: now,
          roles: { set: [] },
          collaborators: { set: [] },
          workSession: { set: [] },
          joinedGameSessions: { set: [] }
        },
        select: { id: true }
      })
    ]);
  }

  private async removeProfileAssets(userId: number): Promise<void> {
    for (const key of [
      profileAssetKey(userId, "profile"),
      profileAssetKey(userId, "background")
    ]) {
      try {
        await this.s3Service.deleteFile({ key });
      } catch (error) {
        this.logger.warn(`Failed to delete ${key}: ${error}`);
      }
    }
  }
}
