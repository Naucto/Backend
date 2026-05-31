import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Project } from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ModerationService } from "src/moderation/moderation.service";
import { AdminProjectFilterDto } from "./dto/projects/admin-project-filter.dto";
import { AdminUpdateProjectDto } from "./dto/projects/admin-update-project.dto";
import {
  AdminProjectListResponseDto,
  AdminProjectResponseDto
} from "./dto/projects/admin-project-response.dto";

@Injectable()
export class AdminProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService
  ) {}

  async list(filter: AdminProjectFilterDto): Promise<AdminProjectListResponseDto> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 25;
    const skip = (page - 1) * limit;

    const where: Prisma.ProjectWhereInput = {};
    if (filter.name)
      where.name = { contains: filter.name, mode: "insensitive" };
    if (filter.status) where.status = filter.status;
    if (filter.hidden !== undefined) where.hidden = filter.hidden;
    if (filter.userId !== undefined) where.userId = filter.userId;

    const orderBy: Prisma.ProjectOrderByWithRelationInput = {};
    const sortBy = filter.sortBy ?? "updatedAt";
    (orderBy as Record<string, "asc" | "desc">)[sortBy] = filter.order ?? "desc";

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({ where, skip, take: limit, orderBy }),
      this.prisma.project.count({ where })
    ]);

    return {
      data: projects.map((project) => this.toResponse(project)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    };
  }

  async findOne(id: number): Promise<AdminProjectResponseDto> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }
    return this.toResponse(project);
  }

  async update(
    id: number,
    dto: AdminUpdateProjectDto,
    actorId: number
  ): Promise<AdminProjectResponseDto> {
    const { reason, ...patch } = dto;
    await this.moderationService.editProject(id, actorId, patch, reason);
    return this.findOne(id);
  }

  async hide(
    id: number,
    actorId: number,
    reason?: string,
    reportId?: number
  ): Promise<AdminProjectResponseDto> {
    await this.moderationService.hideProject(
      id,
      actorId,
      reason ?? null,
      reportId ?? null
    );
    return this.findOne(id);
  }

  async restore(
    id: number,
    actorId: number,
    reason?: string,
    reportId?: number
  ): Promise<AdminProjectResponseDto> {
    await this.moderationService.restoreProject(
      id,
      actorId,
      reason ?? null,
      reportId ?? null
    );
    return this.findOne(id);
  }

  async unpublish(
    id: number,
    actorId: number,
    reason?: string,
    reportId?: number
  ): Promise<AdminProjectResponseDto> {
    await this.moderationService.unpublishProject(
      id,
      actorId,
      reason ?? null,
      reportId ?? null
    );
    return this.findOne(id);
  }

  private toResponse(project: Project): AdminProjectResponseDto {
    return {
      id: project.id,
      name: project.name,
      shortDesc: project.shortDesc,
      longDesc: project.longDesc,
      tags: project.tags,
      publishedTags: project.publishedTags,
      publishedName: project.publishedName,
      publishedShortDesc: project.publishedShortDesc,
      publishedLongDesc: project.publishedLongDesc,
      status: project.status,
      iconUrl: project.iconUrl,
      monetization: project.monetization,
      price: project.price,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      publishedAt: project.publishedAt?.toISOString() ?? null,
      userId: project.userId,
      hidden: project.hidden,
      hiddenReason: project.hiddenReason,
      hiddenAt: project.hiddenAt?.toISOString() ?? null,
      hiddenById: project.hiddenById,
      viewCount: project.viewCount,
      likes: project.likes
    };
  }
}
