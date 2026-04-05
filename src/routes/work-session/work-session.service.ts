import { PrismaService } from "@ourPrisma/prisma.service";
import { WorkSession } from "@prisma/client";
import { UserDto } from "@auth/dto/user.dto";

import { WebRTCService } from "@webrtc/webrtc.service";
import { YjsWebRTCServer } from "@webrtc/server/webrtc.server.yjs";

import { CreateWorkSessionDto } from "@work-session/dto/create-work-session.dto";
import { UpdateWorkSessionDto } from "@work-session/dto/update-work-session.dto";
import { FetchWorkSessionDto } from "@work-session/dto/fetch-work-session.dto";
import { JoinWorkSessionDto } from "@work-session/dto/join-work-session.dto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { uuidv4 } from "lib0/random";

@Injectable()
export class WorkSessionService {
  private readonly _collabServer: YjsWebRTCServer;

  constructor(
    private prismaService: PrismaService,
    private webrtcService: WebRTCService
  ) {
    this._collabServer = new YjsWebRTCServer(webrtcService, "Collaboration");
  }

  async findAll(): Promise<WorkSession[]> {
    return this.prismaService.workSession.findMany({
      include: {
        project: true
      }
    });
  }

  async findOne(id: number): Promise<WorkSession> {
    const workSession = await this.prismaService.workSession.findUnique({
      where: { id },
      include: {
        project: true,
        users: true
      }
    });

    if (!workSession) {
      throw new NotFoundException(`Work session with ID ${id} not found`);
    }

    return workSession;
  }

  async create(
    createWorkSessionDto: CreateWorkSessionDto,
    userId: number
  ): Promise<WorkSession> {
    const project = await this.prismaService.project.findFirst({
      where: {
        id: createWorkSessionDto.projectId,
        collaborators: {
          some: {
            id: userId
          }
        }
      }
    });

    if (!project) {
      throw new NotFoundException(
        "Project not found or does not belong to user"
      );
    }

    return this.prismaService.workSession.create({
      data: {
        startedAt: createWorkSessionDto.startTime ?? new Date(),
        project: {
          connect: { id: createWorkSessionDto.projectId }
        },
        users: {
          connect: [{ id: userId }]
        },
        host: {
          connect: { id: userId }
        }
      },
      include: {
        project: {
          include: {
            collaborators: true
          }
        }
      }
    });
  }

  async update(
    id: number,
    updateWorkSessionDto: UpdateWorkSessionDto
  ): Promise<WorkSession> {
    await this.findOne(id);

    return this.prismaService.workSession.update({
      where: { id },
      data: updateWorkSessionDto,
      include: {
        project: true
      }
    });
  }

  async join(projectId: number, user: UserDto): Promise<JoinWorkSessionDto> {
    const project = await this.prismaService.project.findFirst({
      where: { id: projectId }
    });
    if (project === null) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    let workSession = await this.prismaService.workSession.findFirst({
      where: { projectId }
    });
    if (workSession === null) {
      workSession = await this.prismaService.workSession.create({
        data: {
          project: { connect: { id: projectId } },
          startedAt: new Date(),
          users: {
            connect: { id: user.id }
          },
          host: {
            connect: { id: user.id }
          },
          roomId: uuidv4()
        }
      });
    } else {
      workSession = await this.prismaService.workSession.update({
        data: {
          users: {
            connect: { id: user.id }
          }
        },
        where: { projectId }
      });
    }

    const response = new JoinWorkSessionDto();

    response.roomId      = workSession.roomId;
    response.hostId      = workSession.hostId;
    response.webrtcOffer = this.webrtcService.buildOffer(this._collabServer);

    return response;
  }

  async leave(projectId: number, user: UserDto): Promise<void> {
    const workSession = await this.prismaService.workSession.findFirst({
      where: { projectId: projectId },
      include: {
        users: true
      }
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
          disconnect: { id: user.id }
        }
      }
    });

    if (workSession.hostId == user.id) {
      const newHost = workSession.users.find((u) => u.id !== user.id);
      if (newHost) {
        await this.prismaService.workSession.update({
          where: { id: workSession.id },
          data: { hostId: newHost.id }
        });
      } else {
        await this.prismaService.workSession.delete({
          where: { id: workSession.id }
        });
      }
    }
  }

  async kick(projectId: number, userId: number): Promise<void> {
    const workSession = await this.prismaService.workSession.findFirst({
      where: { projectId: projectId },
      include: {
        users: true
      }
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
        }
      }
    });

    if (workSession.hostId == userId) {
      const newHost = workSession.users.find((u) => u.id !== userId);
      if (newHost) {
        await this.prismaService.workSession.update({
          where: { id: workSession.id },
          data: { hostId: newHost.id }
        });
      } else {
        await this.prismaService.workSession.delete({
          where: { id: workSession.id }
        });
      }
    }
  }

  async getInfo(projectId: number): Promise<FetchWorkSessionDto> {
    const workSession = await this.prismaService.workSession.findFirst({
      where: { projectId },
      include: {
        users: true
      }
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
