import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "@auth/decorators/permissions.decorator";
import { Permission, permissionsFor } from "@auth/permissions";
import { RequestWithUser } from "@auth/auth.types";
import { PrismaService } from "@ourPrisma/prisma.service";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(), context.getClass()
    ]);
    if (!required?.length) return true;
    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    if (!user) return false;
    const current = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { roles: { select: { name: true, permissions: true } } }
    });
    const granted = permissionsFor(current?.roles ?? []);
    return required.every((permission) => granted.includes(permission));
  }
}
