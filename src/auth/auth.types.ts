import { Request } from 'express';

import { SuspensionState } from './access/suspension';
import { UserDto } from './dto/user.dto';

/** The scope of an access token issued by the staff sign-in of the admin console. */
export const STAFF_SCOPE = 'staff';

export interface JwtPayload {
  sub: string;
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

/** A request to a `@Public()` route: the account when a valid token came with it, else null. */
export type RequestWithOptionalUser = Omit<Request, 'user'> & { user: UserDto | null };

export interface OAuthUserPayload {
  email: string;
  name: string;
}
