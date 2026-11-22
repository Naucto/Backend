import { Request } from 'express';

import { SuspensionState } from './access/suspension';
import { UserDto } from './dto/user.dto';

/** The scope of an access token issued by the staff sign-in of the admin console. */
export const STAFF_SCOPE = 'staff';

export interface JwtPayload {
  sub: number;
  email: string;
  scope?: typeof STAFF_SCOPE;
}

/** What a verified access token says beyond whose it is. Reaches a guard as `request.authInfo`. */
export interface TokenInfo {
  staff: boolean;
}

export interface RequestWithUser extends Request {
  user: UserDto & SuspensionState;
}

export interface OAuthUserPayload {
  email: string;
  name: string;
}
