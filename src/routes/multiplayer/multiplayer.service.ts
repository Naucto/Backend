import { Injectable } from "@nestjs/common";
import { GameSession, GameSessionVisibility } from "@prisma/client";
import { PrismaService } from "@prisma/prisma.service";
import { UserService } from "../user/user.service";
import { ProjectService } from "../project/project.service";
import { MultiplayerHostNotFoundError, MultiplayerHostOpenedError, MultiplayerInvalidStateError, MultiplayerUserAlreadyJoinedError } from "./multiplayer.error";

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
    // Check if the user & project exists by simply getting them. If the object does not exist,
    // the exception throw serves as a guard.

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

    await this.userService.attachGameSession(userId, createdGS.id);

    return createdGS;
  }

  async closeHost(userId: number, projectId: number): Promise<void> {
    // Same as for openHost.
    const requestedUser = await this.userService.findOne<{
      hostingGameSessions: GameSession[]
    }>(userId, { hostingGameSessions: true });
    await this.projectService.findOne(projectId);

    const basicHostedGS =
      requestedUser.hostingGameSessions.find((hostedGS) => hostedGS.projectId === projectId);

    if (!basicHostedGS) {
      throw new MultiplayerHostOpenedError("User is not hosting a game session for this project");
    }

    await this.userService.detachGameSession(userId, basicHostedGS.id);

    const hostedGS = await this.prismaService.gameSession.findUnique({
      where: { id: basicHostedGS.id },
      include: { otherUsers: true }
    });

    if (!hostedGS) {
      // This can only be reached if the database is in an inconsitent state
      throw new MultiplayerInvalidStateError("Game session attached to user no longer exists");
    }

    await Promise.all(
      hostedGS.otherUsers.map(async (user) => {
        await this.userService.detachGameSession(user.id, hostedGS.id);
      })
    );
  }

  async joinHost(joiningUserId: number, hostUuid: string): Promise<void> {
    // Same as for openHost.
    const joiningUser = await this.userService.findOne<{
      joinedGameSessions: GameSession[]
    }>(joiningUserId, { joinedGameSessions: true });
    const hostedGS = await this.prismaService.gameSession.findUnique({
      where: { sessionId: hostUuid },
    });

    if (!hostedGS) {
      throw new MultiplayerHostNotFoundError("No game session found for the provided host UUID");
    } else if (hostedGS.hostId === joiningUserId) {
      throw new MultiplayerUserAlreadyJoinedError("User is already the host of this game session");
    } else if (joiningUser.joinedGameSessions.some(joinedGS => joinedGS.id === hostedGS.id)) {
      throw new MultiplayerUserAlreadyJoinedError("User has already joined this game session");
    }

    // Concat the joining user to the game session's otherUsers
    await this.prismaService.gameSession.update({
      where: { id: hostedGS.id },
      data: {
        otherUsers: { connect: { id: joiningUserId } }
      }
    });
  }

  async leaveHost(leavingUserId: number, hostUuid: string): Promise<void> {
    // Same as for openHost.
  }
}
