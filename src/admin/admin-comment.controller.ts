import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Roles } from "@auth/decorators/roles.decorator";
import { RolesGuard } from "@auth/guards/roles.guard";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
import { AdminActor } from "./decorators/admin-actor.decorator";
import { AdminCommentService } from "./admin-comment.service";
import { AdminCommentFilterDto } from "./dto/comments/admin-comment-filter.dto";
import { AdminUpdateCommentDto } from "./dto/comments/admin-update-comment.dto";
import { ModerationReasonDto } from "./dto/moderation-reason.dto";
import {
  AdminCommentListResponseDto,
  AdminCommentResponseDto
} from "./dto/comments/admin-comment-response.dto";

@ApiTags("admin-comments")
@ApiCookieAuth("AdminCookie")
@UseGuards(AdminCookieJwtGuard, RolesGuard)
@Roles("Admin", "Moderator")
@Controller("admin/comments")
export class AdminCommentController {
  constructor(private readonly adminCommentService: AdminCommentService) {}

  @Get()
  @ApiOperation({ summary: "List comments with pagination and filters" })
  async list(
    @Query() filter: AdminCommentFilterDto
  ): Promise<AdminCommentListResponseDto> {
    return this.adminCommentService.list(filter);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single comment" })
  async get(
    @Param("id", ParseIntPipe) id: number
  ): Promise<AdminCommentResponseDto> {
    return this.adminCommentService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit a comment's content as a moderator" })
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AdminUpdateCommentDto,
    @AdminActor() actorId: number
  ): Promise<AdminCommentResponseDto> {
    return this.adminCommentService.edit(id, actorId, dto.content, dto.reason);
  }

  @Post(":id/hide")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Hide a comment" })
  async hide(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminCommentResponseDto> {
    return this.adminCommentService.hide(
      id,
      actorId,
      body.reason,
      body.reportId
    );
  }

  @Post(":id/restore")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Restore a hidden comment" })
  async restore(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminCommentResponseDto> {
    return this.adminCommentService.restore(
      id,
      actorId,
      body.reason,
      body.reportId
    );
  }
}
