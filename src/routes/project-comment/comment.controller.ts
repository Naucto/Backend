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
    return this.projectCommentService.findOne(id, actor);
  }

  @Get()
  @ApiOperation({ summary: "List comments across projects (moderators only)" })
  @ApiResponse({ status: 200, type: CommentListResponseDto })
  @ApiResponse({ status: 403, description: "Staff access required" })
  async list(
    @Query() filter: CommentFilterDto,
    @CurrentActor() actor: Actor
  ): Promise<CommentListResponseDto> {
    return this.projectCommentService.findAll(filter, actor);
  }
}
