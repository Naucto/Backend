import { Request } from 'express';

import { UserDto } from './dto/user.dto';

export interface JwtPayload {
  sub: number;
  email: string;
}

export interface RequestWithUser extends Request {
  user: UserDto;
}

/** A request to a `@Public()` route: the account when a valid bearer came with it, else null. */
export type RequestWithOptionalUser = Omit<Request, 'user'> & {
  user?: { id: number } | null;
};

export interface OAuthUserPayload {
  email: string;
  name: string;
}
