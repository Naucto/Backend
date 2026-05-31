import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy, StrategyOptions } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UserService } from "@user/user.service";
import { AccountStatus, User } from "@prisma/client";
import { JwtPayload } from "@auth/auth.types";
import { Request } from "express";

const ADMIN_ACCESS_COOKIE = "naucto_admin_access";

function adminCookieExtractor(req: Request | null): string | null {
  if (!req) return null;
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[ADMIN_ACCESS_COOKIE] ?? null;
}

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, "admin-jwt") {
  constructor(
    @Inject(ConfigService) configService: ConfigService,
    private readonly userService: UserService
  ) {
    const secret = configService.getOrThrow<string>("JWT_SECRET");
    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromExtractors([adminCookieExtractor]),
      secretOrKey: secret
    };
    super(options);
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.userService.findOne(payload.sub);

    if (user.accountStatus === AccountStatus.BANNED) {
      throw new UnauthorizedException("This account has been banned.");
    }

    return user;
  }
}
