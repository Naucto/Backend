import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const AdminActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest<{ user?: { id?: number } }>();
    const actorId = request.user?.id;
    if (typeof actorId !== "number") {
      throw new Error("AdminActor decorator used outside of authenticated route");
    }
    return actorId;
  }
);
