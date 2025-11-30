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
import { User } from "@prisma/client";

export const CREATOR_SELECT = {
    id: true,
    username: true,
    email: true,
};

export const COLLABORATOR_SELECT = {
    id: true,
    username: true,
    email: true,
};

@Injectable()
export class ProjectService {
    static COLLABORATOR_SELECT = COLLABORATOR_SELECT;
    static CREATOR_SELECT = CREATOR_SELECT;

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
                collaborators: {
                    select: ProjectService.COLLABORATOR_SELECT,
                },
                creator: {
                    select: ProjectService.CREATOR_SELECT,
                },
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
            return await this.prisma.project.create({
                data: {
                    ...createProjectDto,
                    collaborators: {
                        connect: [{ id: userId }],
                    },
                    creator: { connect: { id: userId } },
                },
                include: {
                    collaborators: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        },
                    },
                    creator: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        },
                    },
                },
            });
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
        const project = await this.findOne(id);

        if (project.contentKey) {
            try {
                await this.s3Service.deleteFile(project.contentKey);
            } catch (error: unknown) {
                if (error instanceof Error) {
                    throw new InternalServerErrorException(
                        `Error deleting S3 file with key ${project.contentKey}: ${error.message}`,
                        { cause: error }
                    );
                } else {
                    throw new InternalServerErrorException(
                        `Error deleting S3 file with key ${project.contentKey}: Unknown error`,
                        { cause: error }
                    );
                }
            }
        }

        await this.prisma.project.delete({
            where: { id },
        });

        return;
    }

    private async findUserByIdentifier(dto: AddCollaboratorDto | RemoveCollaboratorDto): Promise<User> {
        let user: User | null = null;
        let identifier: string;

        if ('userId' in dto && dto.userId) {
            identifier = dto.userId.toString();
            user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
        } else if ('username' in dto && dto.username) {
            identifier = dto.username;
            user = await this.prisma.user.findUnique({ where: { username: dto.username } });
        } else if ('email' in dto && dto.email) {
            identifier = dto.email;
            user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        } else {
            throw new BadRequestException("Either userId, username or email must be provided");
        }

        if (!user) {
            throw new NotFoundException(`User with identifier '${identifier}' not found`);
        }

        return user;
    }

    async addCollaborator(id: number, addCollaboratorDto: AddCollaboratorDto): Promise<Project> {
        const user = await this.findUserByIdentifier(addCollaboratorDto);

        const project = await this.prisma.project.findUnique({
            where: { id },
            include: {
                collaborators: true,
            },
        });

        if (!project) {
            throw new NotFoundException(`Project with ID ${id} not found`);
        }

        if (project.collaborators.some((collab) => collab.id === user.id)) {
            throw new BadRequestException(`User is already a collaborator on this project`);
        }

        return this.prisma.project.update({
            where: { id },
            data: {
                collaborators: { connect: { id: user.id } },
            },
            include: {
                collaborators: {
                    select: ProjectService.COLLABORATOR_SELECT,
                },
                creator: {
                    select: ProjectService.CREATOR_SELECT,
                },
            },
        });
    }

    async removeCollaborator(id: number, removeCollaboratorDto: RemoveCollaboratorDto): Promise<Project> {
        const user = await this.findUserByIdentifier(removeCollaboratorDto);

        const project = await this.prisma.project.findUnique({
            where: { id },
            include: {
                collaborators: true,
            },
        });

        if (!project) {
            throw new NotFoundException(`Project with ID ${id} not found`);
        }

        if (user.id === project.userId) {
            throw new ForbiddenException("Cannot remove the project creator");
        }

        if (!project.collaborators.some((collab) => collab.id === user.id)) {
            throw new BadRequestException(`User is not a collaborator on this project`);
        }

        return this.prisma.project.update({
            where: { id },
            data: {
                collaborators: {
                    disconnect: { id: user.id },
                },
            },
            include: {
                collaborators: {
                    select: ProjectService.COLLABORATOR_SELECT,
                },
                creator: {
                    select: ProjectService.CREATOR_SELECT,
                },
            },
        });
    }

    async updateLastTimeUpdate(projectId: number): Promise<void> {
        const sessions = await this.prisma.workSession.findMany({ where : { projectId } });
        if (sessions.length === 0)
            return;
        await this.prisma.workSession.update({
            data: {
                lastSave: new Date()
            },
            where: { projectId }
        });
    }

    async updateContentInfo(projectId: number, contentKey: string, extension: string): Promise<void> {
        await this.prisma.project.update({
            where: { id: projectId },
            data: {
                contentKey,
                contentExtension: extension,
                contentUploadedAt: new Date(),
            },
        });
    } 
}
