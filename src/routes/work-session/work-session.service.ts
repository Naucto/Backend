import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateWorkSessionDto } from "./dto/create-work-session.dto";
import { UpdateWorkSessionDto } from "./dto/update-work-session.dto";
import { uuidv4 } from "lib0/random";
import { WorkSession } from "@prisma/client";
import { JoinRoomResult } from "./work-session.types";
import { UserDto } from "src/auth/dto/user.dto";
import { FetchWorkSessionDto } from "src/routes/work-session/dto/fetch-work-session.dto";

@Injectable()
export class WorkSessionService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<WorkSession[]> {
    return this.prisma.workSession.findMany({
      include: {
        project: true,
      },
    });
  }

  async findOne(id: number): Promise<WorkSession> {
    const workSession = await this.prisma.workSession.findUnique({
      where: { id },
      include: {
        project: true,
        users: true
      },
    });

    if (!workSession) {
      throw new NotFoundException(`Work session with ID ${id} not found`);
    }

    return workSession;
  }

  async create(createWorkSessionDto: CreateWorkSessionDto, userId: number): Promise<WorkSession> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: createWorkSessionDto.projectId,
        collaborators: {
          some: {
            id: userId,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(
        "Project not found or does not belong to user",
      );
    }

    return this.prisma.workSession.create({
      data: {
        startedAt: createWorkSessionDto.startTime ?? new Date(),
        project: {
          connect: { id: createWorkSessionDto.projectId },
        },
        users: {
          connect: [{ id: userId }],
        },
        host:  {
          connect: { id: userId }
        }
      },
      include: {
        project: {
          include: {
            collaborators: true,
          },
        },
      },
    });
  }

  async update(id: number, updateWorkSessionDto: UpdateWorkSessionDto): Promise<WorkSession> {
    await this.findOne(id);

    return this.prisma.workSession.update({
      where: { id },
      data: updateWorkSessionDto,
      include: {
        project: true,
      },
    });
  }

  async join(projectId: number, user: UserDto): Promise<JoinRoomResult> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
    });
    if (project === null) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    let workSession = await this.prisma.workSession.findFirst({
      where: { projectId },
    });
    if (workSession === null) {
      workSession = await this.prisma.workSession.create({
        data: {
          project: { connect: { id: projectId } },
          startedAt: new Date(),
          users: {
            connect: { id: user.id }
          },
          host: {
            connect: { id: user.id }
          },
          roomId: uuidv4(),
          roomPassword: uuidv4()
        },
      });
    } else {
      workSession = await this.prisma.workSession.update({
        data: {
          users: {
            connect: { id : user.id },
          }
        }, where: { projectId }
      });
    }

    return {
      roomId: workSession.roomId,
      roomPassword: workSession.roomPassword,
    };
  }

  async leave(projectId: number, user: UserDto): Promise<void> {
    const workSession = await this.prisma.workSession.findFirst({
      where: { projectId: projectId },
      include: {
        users: true
      }
    });

    if (!workSession) {
      throw new NotFoundException(`Work session for project ID ${projectId} not found`);
    }

    await this.prisma.workSession.update({
      where: { id: workSession.id },
      data: {
        users: {
          disconnect: { id: user.id },
        },
      },
    });

    if (workSession.hostId == user.id) {
      const newHost = workSession.users.find(u => u.id !== user.id);
      if (newHost) {
        await this.prisma.workSession.update({
          where: { id: workSession.id },
          data: { hostId: newHost.id },
        });
      } else {
        await this.prisma.workSession.delete({
          where: { id: workSession.id },
        });
      }

    }
  }

  async kick(projectId: number, userId: number): Promise<void> {
    const workSession = await this.prisma.workSession.findFirst({
      where: { projectId: projectId },
      include: {
        users: true
      }
    });

    if (!workSession) {
      throw new NotFoundException(`Work session for project ID ${projectId}`);
    }

    await this.prisma.workSession.update({
      where: { id: workSession.id },
      data: {
        users: {
          disconnect: { id: userId },
        },
      },
    });

    if (workSession.hostId == userId) {
      const newHost = workSession.users.find(u => u.id !== userId);
      if (newHost) {
        await this.prisma.workSession.update({
          where: { id: workSession.id },
          data: { hostId: newHost.id },
        });
      } else {
        await this.prisma.workSession.delete({
          where: { id: workSession.id },
        });
      }

    }
  }

  async getInfo(projectId: number): Promise<FetchWorkSessionDto> {
    const workSession = await this.prisma.workSession.findFirst({
      where: { projectId },
      include: {
        users: true,
      },
    });

    if (!workSession) {
      throw new NotFoundException(`Work session for project ID ${projectId}`);
    }

    return {
      users: workSession.users.map(user => user.id),
      host: workSession.hostId,
      project: workSession.projectId,
      startedAt: workSession.startedAt,
      roomId: workSession.roomId,
      roomPassword: workSession.roomPassword,
    };
  }
}
