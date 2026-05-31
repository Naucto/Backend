import {
  Body,
  Controller,
  Delete,
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
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags
} from "@nestjs/swagger";
import { Roles } from "@auth/decorators/roles.decorator";
import { RolesGuard } from "@auth/guards/roles.guard";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
import { AdminActor } from "./decorators/admin-actor.decorator";
import { AdminUserService } from "./admin-user.service";
import { AdminUserFilterDto } from "./dto/users/admin-user-filter.dto";
import { CreateAdminUserDto } from "./dto/users/create-admin-user.dto";
import { UpdateAdminUserDto } from "./dto/users/update-admin-user.dto";
import { ResetPasswordDto } from "./dto/users/reset-password.dto";
import { ModerationReasonDto } from "./dto/moderation-reason.dto";
import {
  AdminUserDetailDto,
  AdminUserListResponseDto,
  AdminUserResponseDto
} from "./dto/users/admin-user-response.dto";

@ApiTags("admin-users")
@ApiCookieAuth("AdminCookie")
@UseGuards(AdminCookieJwtGuard, RolesGuard)
@Roles("Admin", "Moderator")
@Controller("admin/users")
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  @Get()
  @ApiOperation({ summary: "List users with pagination and filters" })
  async list(@Query() filter: AdminUserFilterDto): Promise<AdminUserListResponseDto> {
    return this.adminUserService.list(filter);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single user with moderation metadata" })
  async get(
    @Param("id", ParseIntPipe) id: number
  ): Promise<AdminUserDetailDto> {
    return this.adminUserService.findOne(id);
  }

  @Post()
  @Roles("Admin")
  @ApiOperation({ summary: "Create a new staff account" })
  async create(
    @Body() dto: CreateAdminUserDto,
    @AdminActor() actorId: number
  ): Promise<AdminUserResponseDto> {
    return this.adminUserService.createStaff(dto, actorId);
  }

  @Patch(":id")
  @Roles("Admin")
  @ApiOperation({ summary: "Update user fields and/or role membership" })
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateAdminUserDto,
    @AdminActor() actorId: number
  ): Promise<AdminUserResponseDto> {
    return this.adminUserService.update(id, dto, actorId);
  }

  @Delete(":id")
  @Roles("Admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Hard delete a user account" })
  async remove(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<{ success: true }> {
    return this.adminUserService.hardDelete(id, actorId, body.reason);
  }

  @Post(":id/suspend")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Suspend a user account" })
  async suspend(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminUserResponseDto> {
    return this.adminUserService.setStatus(
      id,
      actorId,
      "SUSPENDED",
      body.reason,
      body.reportId
    );
  }

  @Post(":id/ban")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ban a user account" })
  async ban(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminUserResponseDto> {
    return this.adminUserService.setStatus(
      id,
      actorId,
      "BANNED",
      body.reason,
      body.reportId
    );
  }

  @Post(":id/restore")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Restore a suspended/banned user account" })
  async restore(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminUserResponseDto> {
    return this.adminUserService.setStatus(
      id,
      actorId,
      "ACTIVE",
      body.reason,
      body.reportId
    );
  }

  @Post(":id/roles/moderator")
  @Roles("Admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Grant Moderator role" })
  async grantModerator(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminUserResponseDto> {
    return this.adminUserService.grantModerator(id, actorId, body.reason);
  }

  @Delete(":id/roles/moderator")
  @Roles("Admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke Moderator role" })
  async revokeModerator(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminUserResponseDto> {
    return this.adminUserService.revokeModerator(id, actorId, body.reason);
  }

  @Post(":id/reset-password")
  @Roles("Admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset a user's password to a value chosen by an admin" })
  async resetPassword(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
    @AdminActor() actorId: number
  ): Promise<{ success: true }> {
    return this.adminUserService.resetPassword(
      id,
      actorId,
      dto.newPassword,
      dto.reason
    );
  }
}
