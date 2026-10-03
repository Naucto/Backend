import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy, StrategyOptions } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UserService } from "@user/user.service";
import { User } from "@prisma/client";
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

  /** What this returns becomes the request's user, which a handler may answer with as it stands. */
  async validate(payload: JwtPayload): Promise<Omit<User, "password">> {
    const { password: _password, ...account } = await this.userService
      .findOne(payload.sub)
      .catch((error: unknown) => {
        // A token can outlive its account, and that is a failure to authenticate, not a missing page.
        if (error instanceof NotFoundException) {
          throw new UnauthorizedException("Account not found");
        }
        throw error;
      });

    // A soft-deleted account keeps its row but must not authenticate anymore,
    // even with a still-valid access token.
    if (account.deletedAt) {
      throw new UnauthorizedException("Account deleted");
    }

    return account;
  }
}
