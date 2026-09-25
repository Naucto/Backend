import { Request } from "express";
import { UserDto } from "@auth/dto/user.dto";

export type TokenScope = "user" | "admin";

export interface JwtPayload {
  sub: number;
  email: string;
  scope?: TokenScope;
  tokenUse?: "access" | "refresh";
}

export interface TokenBundle {
  access_token: string;
  refresh_token: string;
  access_token_max_age_ms: number;
  refresh_token_max_age_ms: number;
}

export interface AuthenticatedRequest extends Request {
  tokenScope?: TokenScope;
}

export interface RequestWithUser extends AuthenticatedRequest {
  user: UserDto;
}

export interface OAuthUserPayload {
  email: string;
  name: string;
}
