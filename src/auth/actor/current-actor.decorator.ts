import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { RequestWithUser } from "@auth/auth.types";
import { Actor } from "./actor";

/**
 * Injects the authenticated caller as an {@link Actor}.
 *
 * The JWT strategies load roles onto `req.user`, so this costs no extra query.
 */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    return Actor.from(request.user);
  }
);
