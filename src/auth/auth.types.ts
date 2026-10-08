import { Request } from 'express';

import { UserDto } from './dto/user.dto';

export interface JwtPayload {
  sub: number;
  email: string;
  /** Set on tokens the admin panel issues once the second factor, when enabled, was checked. */
  mfa?: boolean;
}

export interface RequestWithUser extends Request {
  user: UserDto;
}

export interface OAuthUserPayload {
  email: string;
  name: string;
}
