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
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Roles } from "@auth/decorators/roles.decorator";
import { RolesGuard } from "@auth/guards/roles.guard";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
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
@UseGuards(AdminCookieJwtGuard, RolesGuard)
@Roles("Admin")
@Controller("admin/roles")
export class AdminRoleController {
  constructor(private readonly adminRoleService: AdminRoleService) {}

  @Get()
  @ApiOperation({ summary: "List roles with user counts" })
  async list(): Promise<AdminRoleResponseDto[]> {
    return this.adminRoleService.list();
  }

  @Post()
  @ApiOperation({ summary: "Create a new role" })
  async create(
    @Body() dto: CreateRoleDto,
    @AdminActor() actorId: number
  ): Promise<AdminRoleResponseDto> {
    return this.adminRoleService.create(dto, actorId);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Rename a non-canonical role" })
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
