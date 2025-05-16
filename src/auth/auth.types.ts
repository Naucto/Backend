export interface UserWithoutPassword {
  id: number;
  email: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginResponse {
  access_token: string;
  user: UserWithoutPassword;
}

export interface JwtPayload {
  sub: number;
  email: string;
}
