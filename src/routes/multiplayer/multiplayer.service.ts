import { Injectable } from "@nestjs/common";
import { GameSession, GameSessionVisibility } from "@prisma/client";
import { PrismaService } from "@prisma/prisma.service";
import { UserService } from "../user/user.service";
import { ProjectService } from "../project/project.service";
import { MultiplayerHostOpenedError } from "./multiplayer.error";

@Injectable()
export class MultiplayerService {
  constructor(
    private userService: UserService,
    private projectService: ProjectService,
    private prismaService: PrismaService
  ) {}

  async lookupHosts(projectId: number, userId: number): Promise<GameSession[]> {
    const matchingGSes = await this.prismaService.gameSession.findMany({
      include: { otherUsers: true },
      where: { projectId: projectId }
    });

    const userAvailableGSes = new Array<GameSession>();

    matchingGSes.forEach((gameSession) => {
      switch (gameSession.visibility) {
      case GameSessionVisibility.PUBLIC:
        break;

      case GameSessionVisibility.FRIENDS_ONLY:
        // FIXME: Check if otherUsers
        // gameSession.otherUsers.some(otherUser => userService.areFriends(userId, otherUserId));
        void userId;
        break;

      case GameSessionVisibility.PRIVATE:
        return;
      }

      userAvailableGSes.push(gameSession);
    });

    return userAvailableGSes;
  }

  async openHost(userId: number, projectId: number, visibility: GameSessionVisibility): Promise<GameSession> {
    // Check if the user & project exists 
    const requestedUser = await this.userService.findOne<{
      hostingGameSessions: GameSession[]
    }>(userId, { hostingGameSessions: true });
    await this.projectService.findOne(projectId);

    requestedUser.hostingGameSessions.forEach((hostedGSes) => {
      if (hostedGSes.projectId != projectId) {
        return;
      }

      throw new MultiplayerHostOpenedError("User already hosting a game session for this project");
    });

    const createdGS = await this.prismaService.gameSession.create({
      data: {
        hostId: userId,
        projectId: projectId,
        visibility: visibility
      }
    });

    return createdGS;
  }

  async closeHost(userId: number, projectId: number): Promise<void> {
    await this.userService.findOne(userId);
    await this.projectService.findOne(projectId);
  }

  async joinHost(hostId: string): Promise<void> {

  }

  async leaveHost(hostId: string): Promise<void> {
    
  }
}
