import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import { AccountStatus } from "@prisma/client";
import { UserDto } from "@auth/dto/user.dto";

type RequestWithAccount = {
  method?: string;
  user?: UserDto & { accountStatus?: AccountStatus };
};

@Injectable()
export class AccountWriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAccount>();
    const method = request.method?.toUpperCase();

    if (!method || ["GET", "HEAD", "OPTIONS"].includes(method)) {
      return true;
    }

    if (request.user?.accountStatus === AccountStatus.SUSPENDED) {
      throw new ForbiddenException(
        "Your account is suspended. You can browse Naucto, but cannot create, publish, comment, like, or join sessions."
      );
    }

    if (request.user?.accountStatus === AccountStatus.BANNED) {
      throw new ForbiddenException("Your account has been banned.");
    }

    return true;
  }
}
