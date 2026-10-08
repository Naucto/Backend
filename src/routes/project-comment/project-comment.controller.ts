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
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public, RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import { CommentResponseDto, PaginatedCommentsResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ProjectCommentService } from './project-comment.service';

@ApiTags('comments')
@Controller('projects/:projectId/comments')
@RequiresAuth()
export class ProjectCommentController {
  constructor(private readonly projectCommentService: ProjectCommentService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get comments for a project' })
  @ApiParam({ name: 'projectId', type: 'number' })
  @ApiQuery({ name: 'page', type: 'number', required: false })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiQuery({
    name: 'sort',
    enum: ['newest', 'oldest'],
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of comments',
    type: PaginatedCommentsResponseDto,
  })
  async getComments(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: 'newest' | 'oldest',
  ): Promise<PaginatedCommentsResponseDto> {
    return this.projectCommentService.getComments(
      projectId,
      page ? parseInt(page, 10) : undefined,
      limit ? parseInt(limit, 10) : undefined,
      sort || 'newest',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a comment on a project' })
  @ApiParam({ name: 'projectId', type: 'number' })
  @ApiBody({ type: CreateCommentDto })
  @ApiResponse({
    status: 201,
    description: 'Comment created',
    type: CommentResponseDto,
  })
  async createComment(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() createCommentDto: CreateCommentDto,
    @Req() req: RequestWithUser,
  ): Promise<CommentResponseDto> {
    return this.projectCommentService.createComment(
      projectId,
      req.user.id,
      createCommentDto.content,
    );
  }

  @Post(':commentId/reply')
  @ApiOperation({ summary: 'Reply to a comment' })
  @ApiParam({ name: 'projectId', type: 'number' })
  @ApiParam({ name: 'commentId', type: 'number' })
  @ApiBody({ type: CreateCommentDto })
  @ApiResponse({
    status: 201,
    description: 'Reply created',
    type: CommentResponseDto,
  })
  async createReply(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() createCommentDto: CreateCommentDto,
    @Req() req: RequestWithUser,
  ): Promise<CommentResponseDto> {
    return this.projectCommentService.createReply(
      projectId,
      commentId,
      req.user.id,
      createCommentDto.content,
    );
  }

  @Put(':commentId')
  @ApiOperation({ summary: 'Edit a comment' })
  @ApiParam({ name: 'projectId', type: 'number' })
  @ApiParam({ name: 'commentId', type: 'number' })
  @ApiBody({ type: CreateCommentDto })
  @ApiResponse({
    status: 200,
    description: 'Comment updated',
    type: CommentResponseDto,
  })
  async updateComment(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Body() createCommentDto: CreateCommentDto,
    @Req() req: RequestWithUser,
  ): Promise<CommentResponseDto> {
    return this.projectCommentService.updateComment(
      projectId,
      commentId,
      req.user.id,
      createCommentDto.content,
    );
  }

  @Delete(':commentId')
  @ApiOperation({ summary: 'Delete a comment' })
  @ApiParam({ name: 'projectId', type: 'number' })
  @ApiParam({ name: 'commentId', type: 'number' })
  @ApiResponse({ status: 204, description: 'Comment deleted' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    return this.projectCommentService.deleteComment(projectId, commentId, req.user.id);
  }
}
