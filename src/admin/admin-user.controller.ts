import { Permission } from "@auth/permissions";
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { Permissions } from "@auth/decorators/permissions.decorator";
import { PermissionsGuard } from "@auth/guards/permissions.guard";
import { StaffSessionGuard } from "@auth/guards/staff-session.guard";
import { AdminActor } from "./decorators/admin-actor.decorator";
import { AdminUserService } from "./admin-user.service";
import { CreateAdminUserDto } from "./dto/users/create-admin-user.dto";
import { ResetPasswordDto } from "./dto/users/reset-password.dto";
import { ModerationReasonDto } from "./dto/moderation-reason.dto";
import {
  AdminUserResponseDto
} from "./dto/users/admin-user-response.dto";

@ApiTags("admin-users")
@ApiCookieAuth("AdminCookie")
@UseGuards(StaffSessionGuard, PermissionsGuard)
@Permissions(Permission.MODERATE_USERS)
@Controller("admin/users")
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  @Post()
  @Permissions(Permission.MANAGE_USERS, Permission.MANAGE_ROLES)
  @ApiOperation({ summary: "Create a new staff account" })
  async create(
    @Body() dto: CreateAdminUserDto,
    @AdminActor() actorId: number
  ): Promise<AdminUserResponseDto> {
    return this.adminUserService.createStaff(dto, actorId);
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

  @Post(":id/roles/:role")
  @Permissions(Permission.MANAGE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Grant an existing role" })
  @ApiParam({ name: "role", type: String })
  @ApiResponse({ status: HttpStatus.OK, type: AdminUserResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Unknown role" })
  async grantRole(
    @Param("id", ParseIntPipe) id: number,
    @Param("role") role: string,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminUserResponseDto> {
    return this.adminUserService.grantRole(
      id,
      actorId,
      role,
      body.reason
    );
  }

  @Delete(":id/roles/:role")
  @Permissions(Permission.MANAGE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke an existing role" })
  @ApiParam({ name: "role", type: String })
  @ApiResponse({ status: HttpStatus.OK, type: AdminUserResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: "Unknown role" })
  async revokeRole(
    @Param("id", ParseIntPipe) id: number,
    @Param("role") role: string,
    @Body() body: ModerationReasonDto,
    @AdminActor() actorId: number
  ): Promise<AdminUserResponseDto> {
    return this.adminUserService.revokeRole(
      id,
      actorId,
      role,
      body.reason
    );
  }

  @Post(":id/reset-password")
  @Permissions(Permission.MANAGE_USERS)
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
