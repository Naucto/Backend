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
import { AdminProjectService } from "./admin-project.service";
import { AdminProjectFilterDto } from "./dto/projects/admin-project-filter.dto";
import { AdminUpdateProjectDto } from "./dto/projects/admin-update-project.dto";
import {
  AdminProjectListResponseDto,
  AdminProjectResponseDto
} from "./dto/projects/admin-project-response.dto";
import { ModerationReasonDto } from "./dto/moderation-reason.dto";

@ApiTags("admin-projects")
@ApiCookieAuth("AdminCookie")
@UseGuards(AdminCookieJwtGuard, RolesGuard)
@Roles("Admin", "Moderator")
@Controller("admin/projects")
export class AdminProjectController {
  constructor(private readonly adminProjectService: AdminProjectService) {}

  @Get()
  @ApiOperation({ summary: "List projects with pagination and filters" })
  async list(
    @Query() filter: AdminProjectFilterDto
  ): Promise<AdminProjectListResponseDto> {
    return this.adminProjectService.list(filter);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single project" })
  async get(
    @Param("id", ParseIntPipe) id: number
  ): Promise<AdminProjectResponseDto> {
    return this.adminProjectService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit project metadata as a moderator" })
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AdminUpdateProjectDto,
    @AdminActor() actorId: number
  ): Promise<AdminProjectResponseDto> {
    return this.adminProjectService.update(id, dto, actorId);
  }

  @Post(":id/hide")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Hide the project from public surfaces" })
  async hide(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminProjectResponseDto> {
    return this.adminProjectService.hide(
      id,
      actorId,
      body.reason,
      body.reportId
    );
  }

  @Post(":id/restore")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Restore a hidden project" })
  async restore(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminProjectResponseDto> {
    return this.adminProjectService.restore(
      id,
      actorId,
      body.reason,
      body.reportId
    );
  }

  @Post(":id/unpublish")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Unpublish a published project" })
  async unpublish(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminProjectResponseDto> {
    return this.adminProjectService.unpublish(
      id,
      actorId,
      body.reason,
      body.reportId
    );
  }
}
