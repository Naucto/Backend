import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { User } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';

import { getEnv } from '../../config/env';
import { UserService } from '../../routes/user/user.service';
import { JwtPayload, STAFF_SCOPE, TokenInfo } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly userService: UserService) {
    const secret = getEnv('JWT_SECRET');
    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
    };
    super(options);
  }

  /**
   * The account becomes the request's user, which a handler may answer with as it stands. Passport
   * hands the second element to the guard apart from it, so nothing about the token reaches a
   * response. The player number stays off it for that reason: only a game table hands it out.
   */
  async validate(
    payload: JwtPayload,
  ): Promise<[Omit<User, 'password' | 'playerNumber'>, TokenInfo]> {
    // The signature vouches for who signed the token, not for what it carries: a subject that is
    // not an id names no account, and must not reach a query as one.
    if (!isUUID(payload.sub)) {
      throw new UnauthorizedException('Account not found');
    }

    const {
      password: _password,
      playerNumber: _playerNumber,
      ...account
    } = await this.userService.findOne(payload.sub).catch((error: unknown) => {
      // A token can outlive its account, and that is a failure to authenticate, not a missing page.
      if (error instanceof NotFoundException) {
        throw new UnauthorizedException('Account not found');
      }
      throw error;
    });

    // A soft-deleted account keeps its row but must not authenticate anymore,
    // even with a still-valid access token.
    if (account.deletedAt) {
      throw new UnauthorizedException('Account deleted');
    }

    return [account, { staff: payload.scope === STAFF_SCOPE }];
  }
}
