import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException
} from "@nestjs/common";
import { PrismaService } from "@prisma/prisma.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import {
  AddCollaboratorDto,
  RemoveCollaboratorDto
} from "./dto/collaborator-project.dto";
import { S3Service } from "@s3/s3.service";
import { Project, User } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { DownloadedFile } from "@s3/s3.interface";

export const CREATOR_SELECT = {
  id: true,
  username: true,
  email: true
};

export const COLLABORATOR_SELECT = {
  id: true,
  username: true,
  email: true
};

type ProjectWithRelations = Project & {
  collaborators: Array<{ id: number; username: string; email: string }>;
  creator: { id: number; username: string; email: string };
};

export type ProjectSave = {
  name: string;
  date: Date;
};

@Injectable()
export class ProjectService {
  static COLLABORATOR_SELECT = COLLABORATOR_SELECT;
  static CREATOR_SELECT = CREATOR_SELECT;

  private readonly max_history_version;
  private readonly max_checkpoints;
  private readonly auto_save_delay;

  constructor(
    @Inject(ConfigService) configService: ConfigService,
    private prisma: PrismaService,
    private readonly s3Service: S3Service
  ) {
    this.max_history_version =
      configService.get<number>("S3_MAX_AUTO_HISTORY_VERSION") ?? 10;
    this.max_checkpoints =
      configService.get<number>("S3_MAX_CHECKPOINTS") ?? 10;
    this.auto_save_delay =
      (configService.get<number>("S3_AUTO_HISTORY_DELAY") ?? 10) * 60000; // from minutes to milliseconds
  }

  async findAll(userId: number): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: {
        collaborators: {
          some: {
            id: userId
          }
        }
      },
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        }
      }
    });
  }

  async findOne(id: number): Promise<ProjectWithRelations> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        }
      }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async create(
    createProjectDto: CreateProjectDto,
    userId: number
  ): Promise<Project> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    try {
      return await this.prisma.project.create({
        data: {
          ...createProjectDto,
          collaborators: {
            connect: [{ id: userId }]
          },
          creator: { connect: { id: userId } }
        },
        include: {
          collaborators: {
            select: ProjectService.COLLABORATOR_SELECT
          },
          creator: {
            select: ProjectService.CREATOR_SELECT
          }
        }
      });
    } catch (error) {
      throw new InternalServerErrorException("Failed to create project", {
        cause: error
      });
    }
  }

  async update(
    id: number,
    updateProjectDto: UpdateProjectDto
  ): Promise<Project> {
    await this.findOne(id);

    return this.prisma.project.update({
      where: { id },
      data: updateProjectDto
    });
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);

    try {
      await this.s3Service.deleteFile({ key: `release/${id}` });

      const checkpoint_prefix = `checkpoint/${id}/`;
      const checkpoints = await this.s3Service.listObjects({
        prefix: checkpoint_prefix
      });
      if (checkpoints.length > 0) {
        const objects = checkpoints.map((o) => o.Key!);
        await this.s3Service.deleteFiles({ keys: objects });
      }

      const save_prefix = `save/${id}/`;
      const saves = await this.s3Service.listObjects({ prefix: save_prefix });
      if (saves.length > 0) {
        const objects = saves.map((o) => o.Key!);
        await this.s3Service.deleteFiles({ keys: objects });
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new InternalServerErrorException(
          `Error deleting S3 file with key ${id}: ${error.message}`,
          { cause: error }
        );
      } else {
        throw new InternalServerErrorException(
          `Error deleting S3 file with key ${id}: Unknown error`,
          { cause: error }
        );
      }
    }

    await this.prisma.project.delete({
      where: { id }
    });

    return;
  }

  private async findUserByIdentifier(
    dto: AddCollaboratorDto | RemoveCollaboratorDto
  ): Promise<User> {
    let user: User | null = null;
    let identifier: string;

    if ("userId" in dto && dto.userId) {
      identifier = dto.userId.toString();
      user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    } else if ("username" in dto && dto.username) {
      identifier = dto.username;
      user = await this.prisma.user.findUnique({
        where: { username: dto.username }
      });
    } else if ("email" in dto && dto.email) {
      identifier = dto.email;
      user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    } else {
      throw new BadRequestException(
        "Either userId, username or email must be provided"
      );
    }

    if (!user) {
      throw new NotFoundException(
        `User with identifier '${identifier}' not found`
      );
    }

    return user;
  }

  async addCollaborator(
    id: number,
    addCollaboratorDto: AddCollaboratorDto
  ): Promise<Project> {
    const user = await this.findUserByIdentifier(addCollaboratorDto);

    if (!user) {
      const identifier =
        addCollaboratorDto.userId ||
        addCollaboratorDto.username ||
        addCollaboratorDto.email;
      throw new NotFoundException(
        `User with identifier '${identifier}' not found`
      );
    }

    const project = await this.findOne(id);

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    if (project.collaborators.some((collab) => collab.id === user.id)) {
      throw new BadRequestException(
        "User is already a collaborator on this project"
      );
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        collaborators: { connect: { id: user.id } }
      },
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        }
      }
    });
  }

  async removeCollaborator(
    id: number,
    removeCollaboratorDto: RemoveCollaboratorDto
  ): Promise<Project> {
    const user = await this.findUserByIdentifier(removeCollaboratorDto);
    const project = await this.findOne(id);
    const projectWithRelations = project as any;

    if (user.id === project.userId) {
      throw new ForbiddenException("Cannot remove the project creator");
    }

    if (
      !projectWithRelations.collaborators.some(
        (collab: any) => collab.id === user.id
      )
    ) {
      throw new BadRequestException(
        "User is not a collaborator on this project"
      );
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        collaborators: {
          disconnect: { id: user.id }
        }
      },
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        }
      }
    });
  }

  async updateLastTimeUpdate(projectId: number): Promise<void> {
    const sessions = await this.prisma.workSession.findMany({
      where: { projectId }
    });
    if (sessions.length === 0) return;
    await this.prisma.workSession.update({
      data: {
        lastSave: new Date()
      },
      where: { projectId }
    });
  }

  async updateContentInfo(
    projectId: number,
    contentKey: string,
    extension: string
  ): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        contentKey,
        contentExtension: extension,
        contentUploadedAt: new Date()
      }
    });
  }

  async save(projectId: number, file: Express.Multer.File): Promise<void> {
    const files = (await this.listVersions(projectId)).sort(
      (a, b) => b.date.getTime() - a.date.getTime()
    );
    const actual_time = Date.now();

    if (files.length >= this.max_history_version) {
      const last_save_time = actual_time - files[1]!.date.getTime();
      const filename_prefix = `save/${projectId}/`;
      if (last_save_time < this.auto_save_delay) {
        await this.s3Service.deleteFile({
          key: filename_prefix + (files[0]?.name ?? "")
        });
      } else {
        await this.s3Service.deleteFile({
          key: filename_prefix + (files[files.length - 1]?.name ?? "")
        });
      }
    }

    await this.updateLastTimeUpdate(projectId);
    await this.s3Service.uploadFile({
      file,
      keyName: `save/${projectId}/${actual_time}`
    });
  }

  async checkpoint(projectId: number, name: string): Promise<void> {
    const checkpoints = (await this.listCheckpoints(projectId)).length;
    if (checkpoints >= this.max_checkpoints) {
      throw new BadRequestException(
        `Reached maximum number of checkpoints (${this.max_checkpoints})`
      );
    }

    const file = await this.fetchLastVersion(projectId);

    await this.s3Service.uploadFile({
      file: file,
      keyName: `checkpoint/${projectId}/${name}`
    });
  }

  async removeCheckpoint(projectId: number, checkpoint: string): Promise<void> {
    await this.s3Service.deleteFile({
      key: `checkpoint/${projectId}/${checkpoint}`
    });
  }

  async publish(projectId: number): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: "COMPLETED"
      }
    });

    const file = await this.fetchLastVersion(projectId);
    await this.s3Service.uploadFile({
      file: file,
      keyName: `release/${projectId}`
    });
  }

  async unpublish(projectId: number): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: "IN_PROGRESS"
      }
    });

    await this.s3Service.deleteFile({ key: `release/${projectId}` });
  }

  async listVersions(projectId: number): Promise<ProjectSave[]> {
    return (
      await this.s3Service.listObjects({ prefix: `save/${projectId}/` })
    ).map((o) => ({ name: o.Key!.split("/").pop()!, date: o.LastModified! }));
  }

  async listCheckpoints(projectId: number): Promise<ProjectSave[]> {
    return (
      await this.s3Service.listObjects({ prefix: `checkpoint/${projectId}/` })
    ).map((o) => ({ name: o.Key!.split("/").pop()!, date: o.LastModified! }));
  }

  async fetchSavedVersion(
    projectId: number,
    version: string
  ): Promise<DownloadedFile> {
    return this.s3Service.downloadFile({ key: `save/${projectId}/${version}` });
  }

  async fetchLastVersion(projectId: number): Promise<DownloadedFile> {
    let files = await this.listVersions(projectId);
    files = files.sort((a, b) => b.date.getTime() - a.date.getTime());
    const filename = `save/${projectId}/${files[0]?.name ?? ""}`;
    return this.s3Service.downloadFile({ key: filename });
  }

  async fetchCheckpoint(
    projectId: number,
    checkpoint: string
  ): Promise<DownloadedFile> {
    const file = `checkpoint/${projectId}/${checkpoint}`;
    return this.s3Service.downloadFile({ key: file });
  }

  async fetchRelease(projectId: number): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId
      },
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        }
      }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    return project;
  }

  async fetchReleaseContent(projectId: number): Promise<DownloadedFile> {
    return this.s3Service.downloadFile({ key: `release/${projectId}` });
  }

  async fetchPublishedGames(): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: {
        status: "COMPLETED"
      },
      include: {
        collaborators: {
          select: ProjectService.COLLABORATOR_SELECT
        },
        creator: {
          select: ProjectService.CREATOR_SELECT
        }
      }
    });
  }
}
