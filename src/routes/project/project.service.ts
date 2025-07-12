import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@prisma/prisma.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import {
  AddCollaboratorDto,
  RemoveCollaboratorDto,
} from "./dto/collaborator-project.dto";
import { S3Service } from "@s3/s3.service";
import { Project } from "@prisma/client";

@Injectable()
export class ProjectService {
  constructor(private prisma: PrismaService, private readonly s3Service: S3Service) {}

  async findAll(userId: number): Promise<Project[]> {
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

  async findOne(id: number): Promise<Project> {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async create(createProjectDto: CreateProjectDto, userId: number): Promise<Project> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    try {
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
    } catch (error) {
      throw new InternalServerErrorException("Failed to create project", { cause: error });
    }
  }

  async update(id: number, updateProjectDto: UpdateProjectDto): Promise<Project> {
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
        throw new InternalServerErrorException(`Error deleting S3 file with key ${id}: ${error.message}`, { cause: error });
      } else {
        throw new InternalServerErrorException(`Error deleting S3 file with key ${id}: Unknown error`, { cause: error });
      }
    }

    await this.prisma.project.delete({
      where: { id },
    });

    return;
  }

  async addCollaborator(id: number, addCollaboratorDto: AddCollaboratorDto): Promise<Project> {
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
      throw new NotFoundException(`User with ID ${addCollaboratorDto.userId} not found`);
    }
    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }
    if (project.collaborators.some((collab) => collab.id === user.id)) {
      throw new BadRequestException(`Project with ID ${id} has already this collaborator`);
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

  async removeCollaborator(id: number, initiator: number, removeCollaboratorDto: RemoveCollaboratorDto): Promise<Project> {
    const user = await this.prisma.user.findUnique({
      where: { id: removeCollaboratorDto.userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${removeCollaboratorDto.userId} not found`);
    }

    const project = await this.prisma.project.findUnique({
      where: { id: id },
      include: {
        collaborators: true,
      },
    });
    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }
    if (removeCollaboratorDto.userId == initiator) {
      throw new ForbiddenException("Cannot remove the project creator");
    }
    if (!project.collaborators.some((collab) => collab.id === user.id)) {
      throw new BadRequestException(`Project with ID ${id} has no collaborator with ID ${user.id}`);
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
