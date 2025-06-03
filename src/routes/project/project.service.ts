import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  AddCollaboratorDto,
  RemoveCollaboratorDto,
} from './dto/collaborator-project.dto';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class ProjectService {
  constructor(private prisma: PrismaService, private readonly s3Service: S3Service) {}

  async findAll(userId: number) {
    return this.prisma.project.findMany({
      where: {
        collaborators: {
          some: {
            id: userId,
          },
        },
      },
      include: {
        collaborators: true,
        creator: true
      },
    });
  }

  async findOne(id: number) {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async create(createProjectDto: CreateProjectDto, userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });


    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }


    const project = await this.prisma.project.create({
      data: {
        ...createProjectDto,
        collaborators: {
          connect: [{ id: userId }],
        },
        creator: { connect: { id: userId } },
      },
      include: {
        collaborators: true,
        creator: true,
      },
    });


    return project;
  }

  async update(id: number, updateProjectDto: UpdateProjectDto) {
    await this.findOne(id);

    return this.prisma.project.update({
      where: { id },
      data: updateProjectDto,
    });
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);

    try {
      await this.s3Service.deleteFile(id.toString());
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Error deleting S3 file with key ${id}: ${error.message}`);
      } else {
        throw new Error(`Error deleting S3 file with key ${id}: Unknown error`);
      }
    }

    await this.prisma.project.delete({
      where: { id },
    });

    return;
  }

  async addCollaborator(id: number, addCollaboratorDto: AddCollaboratorDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: addCollaboratorDto.userId },
    });

    const project = await this.prisma.project.findUnique({
      where: { id: id },
      include: {
        collaborators: true,
      },
    });

    if (!user) {
      throw new Error(`User with ID ${addCollaboratorDto.userId} not found`);
    }
    if (!project) {
      throw new Error(`Project with ID ${id} not found`);
    }
    if (project.collaborators.some((collab) => collab.id === user.id)) {
      throw new Error(`Project with ID ${id} has already this collaborator`);
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        collaborators: { connect: { id: addCollaboratorDto.userId } },
      },
      include: {
        collaborators: true,
      },
    });
  }

  async removeCollaborator(
    id: number,
    initiator: number,
    removeCollaboratorDto: RemoveCollaboratorDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: removeCollaboratorDto.userId },
    });
    const project = await this.prisma.project.findUnique({
      where: { id: id },
      include: {
        collaborators: true,
      },
    });

    if (!user) {
      throw new Error(`User with ID ${removeCollaboratorDto.userId} not found`);
    }
    if (removeCollaboratorDto.userId == initiator) {
      throw new Error(`Cannot remove the project creator`);
    }
    if (!project) {
      throw new Error(`Project with ID ${id} not found`);
    }
    if (!project.collaborators.some((collab) => collab.id === user.id)) {
      throw new Error(
        `Project with ID ${id} has no collaborator with ID ${user.id}`,
      );
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        collaborators: {
          disconnect: { id: removeCollaboratorDto.userId },
        },
      },
      include: {
        collaborators: true,
      },
    });
  }
}
