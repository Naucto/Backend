import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  override canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  override handleRequest<TUser = unknown>(
    _err: unknown,
    user: TUser
  ): TUser | null {
    // If the user is not authenticated, return null instead of throwing
    return user || null;
  }
}
