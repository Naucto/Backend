import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ModerationService } from "src/moderation/moderation.service";
import {
  buildOrderBy,
  paginated,
  resolvePage
} from "./admin-pagination.util";
import { AdminCommentFilterDto } from "./dto/comments/admin-comment-filter.dto";
import {
  AdminCommentListResponseDto,
  AdminCommentResponseDto
} from "./dto/comments/admin-comment-response.dto";

type CommentWithRels = Prisma.CommentGetPayload<{
  include: {
    author: { select: { username: true } };
    project: { select: { name: true; publishedName: true } };
  };
}>;

@Injectable()
export class AdminCommentService {
  private static readonly SORTABLE_FIELDS = [
    "id",
    "createdAt",
    "hiddenAt"
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService
  ) {}

  async list(filter: AdminCommentFilterDto): Promise<AdminCommentListResponseDto> {
    const page = resolvePage(filter);

    const where: Prisma.CommentWhereInput = {};
    if (filter.projectId !== undefined) where.projectId = filter.projectId;
    if (filter.authorId !== undefined) where.authorId = filter.authorId;
    if (filter.hidden !== undefined) where.hidden = filter.hidden;
    if (filter.deleted !== undefined) where.deleted = filter.deleted;

    const orderBy = buildOrderBy<Prisma.CommentOrderByWithRelationInput>(
      filter,
      AdminCommentService.SORTABLE_FIELDS,
      "createdAt"
    );

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy,
        include: {
          author: { select: { username: true } },
          project: { select: { name: true, publishedName: true } }
        }
      }),
      this.prisma.comment.count({ where })
    ]);

    return paginated(comments, total, page, (comment) =>
      this.toResponse(comment)
    );
  }

  async findOne(id: number): Promise<AdminCommentResponseDto> {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      include: {
        author: { select: { username: true } },
        project: { select: { name: true, publishedName: true } }
      }
    });
    if (!comment) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }
    return this.toResponse(comment);
  }

  async edit(
    id: number,
    actorId: number,
    content: string,
    reason?: string
  ): Promise<AdminCommentResponseDto> {
    await this.moderationService.editComment(id, actorId, content, reason);
    return this.findOne(id);
  }

  async hide(
    id: number,
    actorId: number,
    reason?: string,
    reportId?: number
  ): Promise<AdminCommentResponseDto> {
    await this.moderationService.hideComment(
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
  ): Promise<AdminCommentResponseDto> {
    await this.moderationService.restoreComment(
      id,
      actorId,
      reason ?? null,
      reportId ?? null
    );
    return this.findOne(id);
  }

  private toResponse(comment: CommentWithRels): AdminCommentResponseDto {
    return {
      id: comment.id,
      projectId: comment.projectId,
      authorId: comment.authorId,
      parentId: comment.parentId,
      content: comment.content,
      deleted: comment.deleted,
      hidden: comment.hidden,
      hiddenReason: comment.hiddenReason,
      hiddenAt: comment.hiddenAt?.toISOString() ?? null,
      hiddenById: comment.hiddenById,
      createdAt: comment.createdAt.toISOString(),
      authorUsername: comment.author?.username,
      projectName: comment.project?.publishedName ?? comment.project?.name
    };
  }
}
