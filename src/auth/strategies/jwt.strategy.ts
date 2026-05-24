import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy, StrategyOptions } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UserService } from "@user/user.service";
import { AccountStatus, User } from "@prisma/client";
import { JwtPayload } from "@auth/auth.types";

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

  async validate(payload: JwtPayload): Promise<User | undefined> {
    const user = await this.userService.findOne(payload.sub);

    if (user.accountStatus === AccountStatus.BANNED) {
      throw new UnauthorizedException("This account has been banned.");
    }

    return user;
  }
}
