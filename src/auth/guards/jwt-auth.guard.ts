import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "@auth/decorators/public.decorator";

/**
 * Authenticates a caller by bearer token or by admin-panel cookie.
 *
 * Accepting both means one set of routes serves both surfaces: the panel calls
 * the ordinary `/projects/:id` rather than a parallel `/admin/projects/:id`
 * that exists only because its session arrives in a cookie. Each strategy still
 * checks its own `scope` claim, so the two token kinds stay non-interchangeable.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(["jwt", "admin-jwt"]) {
  constructor(private reflector: Reflector) {
    super();
  }

  override canActivate(
    context: ExecutionContext
  ): ReturnType<CanActivate["canActivate"]> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
