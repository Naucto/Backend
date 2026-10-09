import { Request } from 'express';

import { UserDto } from './dto/user.dto';

export interface JwtPayload {
  sub: number;
  email: string;
}

export interface RequestWithUser extends Request {
  user: UserDto;
}

export interface OAuthUserPayload {
  email: string;
  name: string;
}
