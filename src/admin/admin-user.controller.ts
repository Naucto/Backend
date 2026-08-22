import {
  BadRequestException,
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
  ApiParam,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { Roles } from "@auth/decorators/roles.decorator";
import { RolesGuard } from "@auth/guards/roles.guard";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
import { AdminActor } from "./decorators/admin-actor.decorator";
import { isStaffRole, STAFF_ROLES, StaffRole } from "./admin-roles";
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

  @Post(":id/roles/:role")
  @Roles("Admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Grant a staff role (Admin or Moderator)" })
  @ApiParam({ name: "role", enum: STAFF_ROLES })
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
      this.parseStaffRole(role),
      body.reason
    );
  }

  @Delete(":id/roles/:role")
  @Roles("Admin")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke a staff role (Admin or Moderator)" })
  @ApiParam({ name: "role", enum: STAFF_ROLES })
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
      this.parseStaffRole(role),
      body.reason
    );
  }

  /**
   * Only staff roles can be granted through this route. Arbitrary role names go
   * through `PATCH /admin/users/:id`, which replaces the whole set deliberately.
   */
  private parseStaffRole(role: string): StaffRole {
    const normalized =
      role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();

    if (!isStaffRole(normalized)) {
      throw new BadRequestException(
        `Unknown staff role "${role}". Expected one of: ${STAFF_ROLES.join(", ")}`
      );
    }

    return normalized;
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
