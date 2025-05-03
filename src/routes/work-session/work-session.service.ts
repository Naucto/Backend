import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkSessionDto } from './dto/create-work-session.dto';
import { UpdateWorkSessionDto } from './dto/update-work-session.dto';

@Injectable()
export class WorkSessionService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.workSession.findMany({
      include: {
        project: true,
      },
    });
  }

  async findOne(id: number) {
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

  async create(createWorkSessionDto: CreateWorkSessionDto, userId: number) {
    // First check if the project exists and belongs to the user
    // const project = await this.prisma.project.findFirst({
    //   where: {
    //     id: createWorkSessionDto.projectId,
    //     userId: userId,
    //   },
    // });

    // if (!project) {
    //   throw new NotFoundException(`Project not found or does not belong to user`);
    // }

    // return this.prisma.workSession.create({
    //   data: {
    //     ...createWorkSessionDto,
    //     startedAt: createWorkSessionDto.startTime || new Date(), // Default to now if not provided
    //     userId, // Associate with the user who created it
    //   },
    //   include: {
    //     project: true,
    //   },
    // });
  }

  async update(id: number, updateWorkSessionDto: UpdateWorkSessionDto) {
    // First check if the work session exists
    await this.findOne(id);

    // If it exists, update it
    return this.prisma.workSession.update({
      where: { id },
      data: updateWorkSessionDto,
      include: {
        project: true,
      },
    });
  }

  async remove(id: number) {
    // First check if the work session exists
    await this.findOne(id);

    // If it exists, delete it
    await this.prisma.workSession.delete({
      where: { id },
    });
    
    return null; // Return null for 204 No Content response
  }
}