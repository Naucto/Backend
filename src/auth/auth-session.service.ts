import {
  Injectable,
  ForbiddenException,
  Inject,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { AuthService } from "@auth/auth.service";
import { RequestWithUser } from "@auth/auth.types";
import { UserService } from "@user/user.service";
import { Actor } from "@auth/actor";
import { Role } from "@prisma/client";
import { LoginDto } from "@auth/dto/login.dto";
import { SessionUserDto } from "@auth/dto/session-user.dto";

const ACCESS_COOKIE = "naucto_admin_access";
const REFRESH_COOKIE = "naucto_admin_refresh";
const CSRF_COOKIE = "naucto_admin_csrf";

type StaffUser = Pick<
  SessionUserDto,
  "id" | "email" | "username" | "accountStatus"
> & { nickname?: string | null };

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {}

  async login(
    dto: LoginDto,
    res: Response
  ): Promise<SessionUserDto> {
    const tokens = await this.authService.login(dto.email, dto.password, "admin");
    const user = await this.userService.findOne(tokens.userId);
    const me = await this.describeStaff(user);

    this.setAdminCookies(
      res,
      tokens.access_token,
      tokens.refresh_token,
      tokens.access_token_max_age_ms,
      tokens.refresh_token_max_age_ms
    );

    return me;
  }

  async refresh(
    req: Request,
    res: Response
  ): Promise<SessionUserDto> {
    const refreshToken = this.readCookie(req, REFRESH_COOKIE);
    if (!refreshToken) {
      throw new UnauthorizedException("Admin refresh token missing");
    }

    try {
      const tokens = await this.authService.refreshToken(refreshToken, "admin");
      const user = await this.userService.findOne(tokens.userId);
      const me = await this.describeStaff(user);
      this.setAdminCookies(res, tokens.access_token, tokens.refresh_token,
        tokens.access_token_max_age_ms, tokens.refresh_token_max_age_ms);
      return me;
    } catch (error) {
      this.clearAdminCookies(res);
      throw error;
    }
  }

  async logout(
    req: Request,
    res: Response
  ): Promise<{ success: true }> {
    const refreshToken = this.readCookie(req, REFRESH_COOKIE);
    if (refreshToken) {
      await this.authService.revokeRefreshToken(refreshToken);
    }
    this.clearAdminCookies(res);
    return { success: true };
  }

  async me(req: RequestWithUser): Promise<SessionUserDto> {
    return this.describeStaff(req.user);
  }

  private readCookie(req: Request, name: string): string | undefined {
    return (req as Request & { cookies?: Record<string, string> }).cookies?.[
      name
    ];
  }

  private async describeStaff(user: StaffUser): Promise<SessionUserDto> {
    const current = await this.userService.findOne<{ roles: Role[] }>(user.id, { roles: true });
    const actor = Actor.from(current);
    if (!actor.isStaff) throw new ForbiddenException("Staff access required");
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname ?? null,
      accountStatus: user.accountStatus,
      roles: [...actor.roles],
      permissions: [...actor.permissions]
    };
  }

  private setAdminCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
    accessMaxAgeMs: number,
    refreshMaxAgeMs: number
  ): void {
    const nodeEnv = this.configService.get<string>("NODE_ENV") ?? "development";
    const isProd = nodeEnv === "production";
    const domain = this.configService.get<string>("ADMIN_COOKIE_DOMAIN");
    const baseOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict" as const,
      ...(domain ? { domain } : {})
    };

    res.cookie(ACCESS_COOKIE, accessToken, {
      ...baseOptions,
      maxAge: accessMaxAgeMs,
      path: "/"
    });
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...baseOptions,
      maxAge: refreshMaxAgeMs,
      path: "/auth"
    });

    const csrfToken = randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      secure: isProd,
      sameSite: "strict",
      ...(domain ? { domain } : {}),
      maxAge: refreshMaxAgeMs,
      path: "/"
    });
  }

  private clearAdminCookies(res: Response): void {
    const nodeEnv = this.configService.get<string>("NODE_ENV") ?? "development";
    const isProd = nodeEnv === "production";
    const domain = this.configService.get<string>("ADMIN_COOKIE_DOMAIN");
    const baseOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict" as const,
      ...(domain ? { domain } : {})
    };

    res.clearCookie(ACCESS_COOKIE, { ...baseOptions, path: "/" });
    res.clearCookie(REFRESH_COOKIE, { ...baseOptions, path: "/auth" });
    res.clearCookie(CSRF_COOKIE, {
      httpOnly: false,
      secure: isProd,
      sameSite: "strict",
      ...(domain ? { domain } : {}),
      path: "/"
    });
  }
}
