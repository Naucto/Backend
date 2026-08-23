import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy, StrategyOptions } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UserService } from "@user/user.service";
import { AccountStatus, Role, User } from "@prisma/client";
import { JwtPayload } from "@auth/auth.types";
import { stripPassword } from "@auth/auth.utils";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(ConfigService) configService: ConfigService,
    private readonly userService: UserService
  ) {
    const secret = configService.getOrThrow<string>("JWT_SECRET");
    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret
    };
    super(options);
  }

  async validate(
    payload: JwtPayload
  ): Promise<(User & { roles: Role[] }) | undefined> {
    // Admin-panel cookies are signed with the same secret as API bearer tokens,
    // so reject them here rather than let one stand in for the other.
    if (payload.scope === "admin") {
      throw new UnauthorizedException("This token is not valid for the API.");
    }

    const user = await this.userService.findOne<{ roles: Role[] }>(
      payload.sub,
      { roles: true }
    );

    if (user.accountStatus === AccountStatus.BANNED) {
      throw new UnauthorizedException("This account has been banned.");
    }

    // Strip the hash before it reaches `req.user`: any handler that echoes the
    // request user would otherwise leak it. Password checks all re-read the row
    // themselves, so nothing downstream needs it.
    return stripPassword(user);
  }
}
