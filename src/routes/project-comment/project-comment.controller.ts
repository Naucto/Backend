import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { AccountWriteGuard } from "@auth/guards/account-write.guard";
import { Public } from "@auth/decorators/public.decorator";
import { UserDto } from "@auth/dto/user.dto";
import { Actor, CurrentActor } from "@auth/actor";
import { Request } from "express";
import { ProjectCommentService } from "./project-comment.service";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { UpdateCommentDto } from "./dto/update-comment.dto";
import { ModeratedCommentFieldsDto } from "./dto/comment-response.dto";
import {
  CommentResponseDto,
  PaginatedCommentsResponseDto
} from "./dto/comment-response.dto";

interface RequestWithUser extends Request {
  user: UserDto;
}

@ApiTags("comments")
@Controller("projects/:projectId/comments")
@UseGuards(JwtAuthGuard, AccountWriteGuard)
export class ProjectCommentController {
  constructor(private readonly projectCommentService: ProjectCommentService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Get comments for a project" })
  @ApiParam({ name: "projectId", type: "number" })
  @ApiQuery({ name: "page", type: "number", required: false })
  @ApiQuery({ name: "limit", type: "number", required: false })
  @ApiQuery({
    name: "sort",
    enum: ["newest", "oldest"],
    required: false
  })
  @ApiResponse({
    status: 200,
    description: "Paginated list of comments",
    type: PaginatedCommentsResponseDto
  })
  async getComments(
    @Param("projectId", ParseIntPipe) projectId: number,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("sort") sort?: "newest" | "oldest"
  ): Promise<PaginatedCommentsResponseDto> {
    return this.projectCommentService.getComments(
      projectId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      sort || "newest"
    );
  }

  @Post()
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Create a comment on a project" })
  @ApiParam({ name: "projectId", type: "number" })
  @ApiBody({ type: CreateCommentDto })
  @ApiResponse({
    status: 201,
    description: "Comment created",
    type: CommentResponseDto
  })
  @HttpCode(HttpStatus.CREATED)
  async createComment(
    @Param("projectId", ParseIntPipe) projectId: number,
    @Body() createCommentDto: CreateCommentDto,
    @Req() req: RequestWithUser
  ): Promise<CommentResponseDto> {
    return this.projectCommentService.createComment(
      projectId,
      req.user.id,
      createCommentDto.content
    );
  }

  @Post(":commentId/reply")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Reply to a comment" })
  @ApiParam({ name: "projectId", type: "number" })
  @ApiParam({ name: "commentId", type: "number" })
  @ApiBody({ type: CreateCommentDto })
  @ApiResponse({
    status: 201,
    description: "Reply created",
    type: CommentResponseDto
  })
  @HttpCode(HttpStatus.CREATED)
  async createReply(
    @Param("projectId", ParseIntPipe) projectId: number,
    @Param("commentId", ParseIntPipe) commentId: number,
    @Body() createCommentDto: CreateCommentDto,
    @Req() req: RequestWithUser
  ): Promise<CommentResponseDto> {
    return this.projectCommentService.createReply(
      projectId,
      commentId,
      req.user.id,
      createCommentDto.content
    );
  }

  @Put(":commentId")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Edit a comment" })
  @ApiParam({ name: "projectId", type: "number" })
  @ApiParam({ name: "commentId", type: "number" })
  @ApiBody({ type: UpdateCommentDto })
  @ApiResponse({
    status: 200,
    description: "Comment updated",
    type: CommentResponseDto
  })
  async updateComment(
    @Param("commentId", ParseIntPipe) commentId: number,
    @Body() dto: UpdateCommentDto,
    @CurrentActor() actor: Actor
  ): Promise<CommentResponseDto & ModeratedCommentFieldsDto> {
    return this.projectCommentService.updateComment(commentId, actor, dto);
  }

  @Delete(":commentId")
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Delete a comment" })
  @ApiParam({ name: "projectId", type: "number" })
  @ApiParam({ name: "commentId", type: "number" })
  @ApiResponse({ status: 204, description: "Comment deleted" })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(
    @Param("projectId", ParseIntPipe) projectId: number,
    @Param("commentId", ParseIntPipe) commentId: number,
    @CurrentActor() actor: Actor
  ): Promise<void> {
    return this.projectCommentService.deleteComment(
      projectId,
      commentId,
      actor
    );
  }
}
