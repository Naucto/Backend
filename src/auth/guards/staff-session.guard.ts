import { ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RequestWithUser } from "@auth/auth.types";
import { Actor } from "@auth/actor";
import { AccountStatus } from "@prisma/client";

@Injectable()
export class StaffSessionGuard extends JwtAuthGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    if (req.tokenScope !== "admin") throw new UnauthorizedException("Staff session required");
    if (req.user.accountStatus !== AccountStatus.ACTIVE || !Actor.from(req.user).isStaff) {
      throw new ForbiddenException("Active staff access required");
    }
    return true;
  }
}
