import { Permission } from "@auth/permissions";
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
  UseGuards
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Permissions } from "@auth/decorators/permissions.decorator";
import { PermissionsGuard } from "@auth/guards/permissions.guard";
import { StaffSessionGuard } from "@auth/guards/staff-session.guard";
import { AdminActor } from "./decorators/admin-actor.decorator";
import { AdminRoleService } from "./admin-role.service";
import {
  AdminRoleResponseDto,
  CreateRoleDto,
  DeleteRoleDto,
  UpdateRoleDto
} from "./dto/roles/admin-role.dto";

@ApiTags("admin-roles")
@ApiCookieAuth("AdminCookie")
@UseGuards(StaffSessionGuard, PermissionsGuard)
@Permissions(Permission.MANAGE_ROLES)
@Controller("admin/roles")
export class AdminRoleController {
  constructor(private readonly adminRoleService: AdminRoleService) {}

  @Get()
  @ApiResponse({ status: 200, type: [AdminRoleResponseDto] })
  @ApiOperation({ summary: "List roles with user counts" })
  async list(): Promise<AdminRoleResponseDto[]> {
    return this.adminRoleService.list();
  }

  @Post()
  @ApiResponse({ status: 201, type: AdminRoleResponseDto })
  @ApiOperation({ summary: "Create a new role" })
  async create(
    @Body() dto: CreateRoleDto,
    @AdminActor() actorId: number
  ): Promise<AdminRoleResponseDto> {
    return this.adminRoleService.create(dto, actorId);
  }

  @Patch(":id")
  @ApiResponse({ status: 200, type: AdminRoleResponseDto })
  @ApiOperation({ summary: "Update a custom role name and permissions" })
  async rename(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
    @AdminActor() actorId: number
  ): Promise<AdminRoleResponseDto> {
    return this.adminRoleService.rename(id, dto, actorId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete an empty non-canonical role" })
  async remove(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: DeleteRoleDto,
    @AdminActor() actorId: number
  ): Promise<{ success: true }> {
    return this.adminRoleService.remove(id, dto, actorId);
  }
}
