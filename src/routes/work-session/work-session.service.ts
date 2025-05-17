import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkSessionDto } from './dto/create-work-session.dto';
import { UpdateWorkSessionDto } from './dto/update-work-session.dto';
import { User } from '../user/entities/user.entity';
import { uuidv4 } from 'lib0/random';
import { WorkSession } from '@prisma/client';
import { JoinRoomResult } from './work-session.types';

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
        `Project not found or does not belong to user`,
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

  async remove(id: number): Promise<void> {
    await this.findOne(id);

    await this.prisma.workSession.delete({
      where: { projectId: id },
    });

    return;
  }

  async join(projectId: number, user: User): Promise<JoinRoomResult> {
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
          projectId,
          startedAt: new Date(),
          users: {
            connect: { id: user.id },
          },
          roomId: uuidv4(),
          roomPassword: uuidv4(),
        },
      });
    }

    const result: JoinRoomResult = {
      roomId: workSession.roomId,
      roomPassword: workSession.roomPassword,
    };
    return result;
  }
}
