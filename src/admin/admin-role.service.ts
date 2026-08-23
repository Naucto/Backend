import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ModerationService } from "src/moderation/moderation.service";
import {
  AdminRoleResponseDto,
  CreateRoleDto,
  DeleteRoleDto,
  UpdateRoleDto
} from "./dto/roles/admin-role.dto";

const CANONICAL_ROLES = new Set(["Admin", "Moderator"]);

@Injectable()
export class AdminRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService
  ) {}

  async list(): Promise<AdminRoleResponseDto[]> {
    const roles = await this.prisma.role.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { users: true } } }
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      userCount: role._count.users,
      canonical: CANONICAL_ROLES.has(role.name)
    }));
  }

  async create(
    dto: CreateRoleDto,
    actorId: number
  ): Promise<AdminRoleResponseDto> {
    if (CANONICAL_ROLES.has(dto.name)) {
      throw new BadRequestException(
        `Role '${dto.name}' is canonical and cannot be created via API`
      );
    }
    const existing = await this.prisma.role.findUnique({
      where: { name: dto.name }
    });
    if (existing) {
      throw new ConflictException(`Role '${dto.name}' already exists`);
    }
    const created = await this.prisma.role.create({ data: { name: dto.name } });
    await this.moderationService.recordRoleCreated(
      created.id,
      actorId,
      created,
      dto.reason
    );
    return {
      id: created.id,
      name: created.name,
      userCount: 0,
      canonical: false
    };
  }

  async rename(
    id: number,
    dto: UpdateRoleDto,
    actorId: number
  ): Promise<AdminRoleResponseDto> {
    const before = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } }
    });
    if (!before) throw new NotFoundException(`Role with ID ${id} not found`);
    if (CANONICAL_ROLES.has(before.name)) {
      throw new BadRequestException(
        `Canonical role '${before.name}' cannot be renamed`
      );
    }
    if (CANONICAL_ROLES.has(dto.name)) {
      throw new BadRequestException(
        `Cannot rename a role to canonical name '${dto.name}'`
      );
    }
    if (dto.name === before.name) {
      return {
        id: before.id,
        name: before.name,
        userCount: before._count.users,
        canonical: false
      };
    }

    const conflict = await this.prisma.role.findUnique({
      where: { name: dto.name }
    });
    if (conflict) {
      throw new ConflictException(`Role '${dto.name}' already exists`);
    }

    const after = await this.prisma.role.update({
      where: { id },
      data: { name: dto.name },
      include: { _count: { select: { users: true } } }
    });
    await this.moderationService.recordRoleRenamed(
      id,
      actorId,
      { id: before.id, name: before.name },
      { id: after.id, name: after.name },
      dto.reason
    );
    return {
      id: after.id,
      name: after.name,
      userCount: after._count.users,
      canonical: false
    };
  }

  async remove(
    id: number,
    dto: DeleteRoleDto,
    actorId: number
  ): Promise<{ success: true }> {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } }
    });
    if (!role) throw new NotFoundException(`Role with ID ${id} not found`);
    if (CANONICAL_ROLES.has(role.name)) {
      throw new BadRequestException(
        `Canonical role '${role.name}' cannot be deleted`
      );
    }
    if (role._count.users > 0) {
      throw new BadRequestException(
        `Role '${role.name}' still has ${role._count.users} users assigned`
      );
    }
    await this.moderationService.recordRoleDeleted(
      id,
      actorId,
      { id: role.id, name: role.name },
      dto.reason
    );
    await this.prisma.role.delete({ where: { id } });
    return { success: true };
  }
}
