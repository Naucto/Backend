import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { Actor, CurrentActor } from "@auth/actor";
import { CommentFilterDto } from "./dto/comment-filter.dto";
import {
  CommentListResponseDto,
  CommentResponseDto,
  ModeratedCommentFieldsDto
} from "./dto/comment-response.dto";
import { ProjectCommentService } from "./project-comment.service";

/**
 * Cross-project comment queries.
 *
 * Lives on the comment resource rather than under `/admin` because it is the
 * same data as `/projects/:id/comments`, just not scoped to one project. The
 * service refuses the moderation filters for a non-moderator.
 */
@ApiTags("comments")
@ApiBearerAuth("JWT-auth")
@Controller("comments")
@UseGuards(JwtAuthGuard)
export class CommentController {
  constructor(private readonly projectCommentService: ProjectCommentService) {}

  @Get(":id")
  @ApiOperation({ summary: "Fetch one comment by id (moderators only)" })
  @ApiResponse({ status: 200, type: CommentResponseDto })
  @ApiResponse({ status: 403, description: "Staff access required" })
  async findOne(
    @Param("id", ParseIntPipe) id: number,
    @CurrentActor() actor: Actor
  ): Promise<CommentResponseDto & ModeratedCommentFieldsDto> {
    return this.projectCommentService.findOneForModeration(id, actor);
  }

  @Get()
  @ApiOperation({ summary: "List comments across projects (moderators only)" })
  @ApiResponse({ status: 200, type: CommentListResponseDto })
  @ApiResponse({ status: 403, description: "Staff access required" })
  async list(
    @Query() filter: CommentFilterDto,
    @CurrentActor() actor: Actor
  ): Promise<CommentListResponseDto> {
    return this.projectCommentService.findAllForModeration(filter, actor);
  }
}
