import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "@auth/decorators/roles.decorator";
import { PrismaService } from "@ourPrisma/prisma.service";

/**
 * Reads roles through `PrismaService` (which is global) rather than
 * `UserService`, so any feature module can declare this guard without importing
 * `UserModule` -- `UserModule` already imports `ProjectModule`, so that route
 * would make the module graph circular.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      return false;
    }

    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { roles: { select: { name: true } } }
    });

    if (!record) {
      return false;
    }

    const userRoles = record.roles.map((role) => role.name);

    return requiredRoles.some((role) => userRoles.includes(role));
  }
}
