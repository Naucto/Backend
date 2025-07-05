import { Request } from "express";
import { UserDto } from "src/auth/dto/user.dto";

export interface JwtPayload {
  sub: number;
  email: string;
}

export interface RequestWithUser extends Request {
  user: UserDto;
}
