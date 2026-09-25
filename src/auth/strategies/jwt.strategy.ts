import { permissionsFor } from "@auth/permissions";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy, StrategyOptions } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UserService } from "@user/user.service";
import { AccountStatus, Role, User } from "@prisma/client";
import { AuthenticatedRequest, JwtPayload } from "@auth/auth.types";
import { stripPassword } from "@auth/auth.utils";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(ConfigService) configService: ConfigService,
    private readonly userService: UserService
  ) {
    const secret = configService.getOrThrow<string>("JWT_SECRET");
    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: AuthenticatedRequest) => req.cookies?.["naucto_admin_access"] ?? null
      ]),
      passReqToCallback: true,
      secretOrKey: secret
    };
    super(options);
  }

  async validate(
    req: AuthenticatedRequest,
    payload: JwtPayload
  ): Promise<(User & { roles: Role[] }) | undefined> {
    const scope = payload.scope ?? "user";
    if (!["user", "admin"].includes(scope) || payload.tokenUse === "refresh") {
      throw new UnauthorizedException("Invalid access token");
    }
    if (!ExtractJwt.fromAuthHeaderAsBearerToken()(req) && scope !== "admin") {
      throw new UnauthorizedException("Staff session required for cookie authentication");
    }
    req.tokenScope = scope;

    const user = await this.userService.findOne<{ roles: Role[] }>(
      payload.sub,
      { roles: true }
    );

    if (user.accountStatus === AccountStatus.BANNED) {
      throw new UnauthorizedException("This account has been banned.");
    }

    return stripPassword({ ...user, roles: user.roles.map((role) => ({
      ...role, permissions: permissionsFor([role])
    })) });
  }
}
