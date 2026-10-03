import { PrismaService, isUniqueViolation } from "@ourPrisma/prisma.service";
import { WorkSession } from "@prisma/client";
import { UserDto } from "@auth/dto/user.dto";

import { WebRTCService } from "@webrtc/webrtc.service";
import { YjsWebRTCServer } from "@webrtc/server/webrtc.server.yjs";

import { FetchWorkSessionDto } from "@work-session/dto/fetch-work-session.dto";
import { JoinWorkSessionDto } from "@work-session/dto/join-work-session.dto";

import { Injectable, Logger, NotFoundException } from "@nestjs/common";

@Injectable()
export class WorkSessionService {
  private readonly _logger: Logger = new Logger(WorkSessionService.name);
  private readonly _collabServer: YjsWebRTCServer;

  constructor(
    private prismaService: PrismaService,
    private webrtcService: WebRTCService
  ) {
    this._collabServer = new YjsWebRTCServer(webrtcService, "Collaboration");
  }

  /**
   * The host is always somebody present. When the recorded one has gone, the present member with
   * the lowest id takes over: deterministic, so two peers reporting the same drop agree on who.
   */
  private async electHost(sessionId: number): Promise<number> {
    const session = await this.prismaService.workSession.findUnique({
      where: { id: sessionId },
      include: { users: { select: { id: true } } }
    });
    if (!session) {
      throw new NotFoundException(`Work session ${sessionId} not found`);
    }
    if (session.users.some((u) => u.id === session.hostId)) {
      return session.hostId;
    }

    const next = session.users.map((u) => u.id).sort((a, b) => a - b)[0];
    if (next === undefined) {
      return session.hostId;
    }

    this._logger.log(
      `Host #${session.hostId} left work session ${sessionId}, #${next} takes over`
    );
    await this.prismaService.workSession.update({
      where: { id: sessionId },
      data: { host: { connect: { id: next } } }
    });

    return next;
  }

  async join(projectId: number, user: UserDto): Promise<JoinWorkSessionDto> {
    const joinExisting = (): Promise<WorkSession> =>
      this.prismaService.workSession.update({
        where: { projectId },
        data: {
          users: { connect: { id: user.id } },
          lastActiveAt: new Date()
        }
      });

    let workSession = await this.prismaService.workSession.findUnique({
      where: { projectId }
    });

    if (workSession) {
      this._logger.log(`Joining existing worksession for project ${projectId}`);

      workSession = await joinExisting();
    } else {
      this._logger.log(`Creating a new worksession for project ${projectId}`);

      try {
        workSession = await this.prismaService.workSession.create({
          data: {
            project: { connect: { id: projectId } },
            startedAt: new Date(),
            users: { connect: { id: user.id } },
            host: { connect: { id: user.id } }
          }
        });
      } catch (error) {
        // A project has one work session: of two collaborators who open it together, the one whose creation is refused joins the other's.
        if (!isUniqueViolation(error)) {
          throw error;
        }

        workSession = await joinExisting();
      }
    }

    this._logger.log(
      `Yielding worksession with roomId=${workSession.roomId} to user #${user.id}`
    );

    const response = new JoinWorkSessionDto();

    response.roomId = workSession.roomId;
    response.hostId = await this.electHost(workSession.id);
    response.webrtcOffer = this.webrtcService.buildOffer(this._collabServer);

    return response;
  }

  async kick(projectId: number, userId: number): Promise<void> {
    const workSession = await this.prismaService.workSession.findFirst({
      where: { projectId: projectId }
    });

    if (!workSession) {
      throw new NotFoundException(
        `Work session for project ID ${projectId} not found`
      );
    }

    await this.prismaService.workSession.update({
      where: { id: workSession.id },
      data: {
        users: {
          disconnect: { id: userId }
        },
        lastActiveAt: new Date()
      }
    });
    await this.electHost(workSession.id);
  }

  async leave(projectId: number, user: UserDto): Promise<void> {
    await this.kick(projectId, user.id);
  }

  async getInfo(projectId: number): Promise<FetchWorkSessionDto> {
    const workSession = await this.prismaService.workSession.findFirst({
      where: { projectId },
      include: { users: { select: { id: true } } }
    });

    if (!workSession) {
      throw new NotFoundException(
        `Work session for project ID ${projectId} not found`
      );
    }

    return {
      users: workSession.users.map((user) => user.id),
      hostId: workSession.hostId,
      project: workSession.projectId,
      startedAt: workSession.startedAt,
      roomId: workSession.roomId
    };
  }
}
