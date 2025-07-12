import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy, StrategyOptions } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UserService } from "@user/user.service";
import { User } from "@prisma/client";
import { JwtPayload } from "../auth.types";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly userService: UserService,
  ) {
    const secret = config.getOrThrow<string>("JWT_SECRET");
    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    };
    super(options);
  }

  async validate(payload: JwtPayload): Promise<User | undefined>  {
    return this.userService.findOne(payload.sub);
  }
}
