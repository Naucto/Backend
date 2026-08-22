import { Request } from "express";
import { UserDto } from "@auth/dto/user.dto";

/**
 * Which surface a token was minted for. Admin-panel cookies and regular API
 * bearer tokens are signed with the same secret, so the scope claim is what
 * actually keeps them from being used interchangeably.
 *
 * Tokens issued before this claim existed carry no `scope` and are treated as
 * "user", which is the safe default: they can never satisfy an admin guard.
 */
export type TokenScope = "user" | "admin";

export interface JwtPayload {
  sub: number;
  email: string;
  scope?: TokenScope;
}

/** A freshly minted token pair plus the cookie max-ages that match its TTLs. */
export interface TokenBundle {
  access_token: string;
  refresh_token: string;
  access_token_max_age_ms: number;
  refresh_token_max_age_ms: number;
}

export interface RequestWithUser extends Request {
  user: UserDto;
}

export interface OAuthUserPayload {
  email: string;
  name: string;
}
