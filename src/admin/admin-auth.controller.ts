import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { AuthService } from "@auth/auth.service";
import { JwtPayload, RequestWithUser } from "@auth/auth.types";
import { UserService } from "@user/user.service";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { AdminMeDto } from "./dto/admin-me.dto";

const ACCESS_COOKIE = "naucto_admin_access";
const REFRESH_COOKIE = "naucto_admin_refresh";
const CSRF_COOKIE = "naucto_admin_csrf";

const STAFF_ROLES = ["Admin", "Moderator"] as const;

@ApiTags("admin-auth")
@Controller("admin/auth")
export class AdminAuthController {
  private readonly logger = new Logger(AdminAuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Authenticate a staff user and set HTTP-only admin cookies"
  })
  @ApiResponse({ status: HttpStatus.OK, type: AdminMeDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.FORBIDDEN })
  async login(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<AdminMeDto> {
    const user = await this.authService.validateUser(dto.email, dto.password);
    const roles = await this.userService.getUserRoles(user.id);
    const isStaff = roles.some((role) =>
      (STAFF_ROLES as readonly string[]).includes(role)
    );

    if (!isStaff) {
      this.logger.warn(
        `Non-staff user ${user.email} attempted admin login (roles=${roles.join(",")})`
      );
      throw new ForbiddenException("Staff access required");
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const tokens = await this.authService.generateAdminTokens(payload, user.id);

    this.setAdminCookies(
      res,
      tokens.access_token,
      tokens.refresh_token,
      tokens.access_token_max_age_ms,
      tokens.refresh_token_max_age_ms
    );

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname ?? null,
      accountStatus: user.accountStatus,
      roles
    };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate the admin access token via refresh cookie" })
  @ApiResponse({ status: HttpStatus.OK, type: AdminMeDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<AdminMeDto> {
    const refreshToken = (
      req as Request & { cookies?: Record<string, string> }
    ).cookies?.[REFRESH_COOKIE];
    if (!refreshToken) {
      throw new UnauthorizedException("Admin refresh token missing");
    }

    const refreshed = await this.authService.refreshToken(refreshToken);

    // Decode payload (sub) without verifying because refreshToken already verified
    const payloadSegment = refreshed.access_token.split(".")[1] ?? "";
    let userId: number | null = null;
    try {
      const decoded = JSON.parse(
        Buffer.from(payloadSegment, "base64").toString("utf-8")
      ) as JwtPayload;
      userId = typeof decoded.sub === "number" ? decoded.sub : null;
    } catch {
      userId = null;
    }

    if (!userId) {
      throw new UnauthorizedException("Invalid refresh response");
    }

    const user = await this.userService.findOne(userId);
    const roles = await this.userService.getUserRoles(user.id);
    const isStaff = roles.some((role) =>
      (STAFF_ROLES as readonly string[]).includes(role)
    );

    if (!isStaff) {
      this.clearAdminCookies(res);
      throw new ForbiddenException("Staff access revoked");
    }

    // Re-derive max ages from configured envs (kept in sync with login)
    const accessMaxAgeMs = this.parseDurationMs(
      this.configService.get<string>("JWT_ADMIN_ACCESS_EXPIRES_IN"),
      30 * 60 * 1000
    );
    const refreshMaxAgeMs = this.parseDurationMs(
      this.configService.get<string>("JWT_ADMIN_REFRESH_EXPIRES_IN"),
      8 * 60 * 60 * 1000
    );

    this.setAdminCookies(
      res,
      refreshed.access_token,
      refreshed.refresh_token,
      accessMaxAgeMs,
      refreshMaxAgeMs
    );

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname ?? null,
      accountStatus: user.accountStatus,
      roles
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminCookieJwtGuard)
  @ApiCookieAuth("AdminCookie")
  @ApiOperation({ summary: "Revoke admin refresh token and clear cookies" })
  @ApiResponse({ status: HttpStatus.OK })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ success: true }> {
    const refreshToken = (
      req as Request & { cookies?: Record<string, string> }
    ).cookies?.[REFRESH_COOKIE];
    if (refreshToken) {
      await this.authService.revokeRefreshToken(refreshToken);
    }
    this.clearAdminCookies(res);
    return { success: true };
  }

  @Get("me")
  @UseGuards(AdminCookieJwtGuard)
  @ApiCookieAuth("AdminCookie")
  @ApiOperation({ summary: "Return the current authenticated staff user" })
  @ApiResponse({ status: HttpStatus.OK, type: AdminMeDto })
  async me(@Req() req: RequestWithUser): Promise<AdminMeDto> {
    const roles = await this.userService.getUserRoles(req.user.id);
    const isStaff = roles.some((role) =>
      (STAFF_ROLES as readonly string[]).includes(role)
    );
    if (!isStaff) {
      throw new ForbiddenException("Staff access required");
    }
    return {
      id: req.user.id,
      email: req.user.email,
      username: req.user.username,
      nickname: req.user.nickname ?? null,
      accountStatus: req.user.accountStatus,
      roles
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
      path: "/admin/auth"
    });

    const csrfToken = randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      secure: isProd,
      sameSite: "strict",
      ...(domain ? { domain } : {}),
      maxAge: accessMaxAgeMs,
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
    res.clearCookie(REFRESH_COOKIE, { ...baseOptions, path: "/admin/auth" });
    res.clearCookie(CSRF_COOKIE, {
      httpOnly: false,
      secure: isProd,
      sameSite: "strict",
      ...(domain ? { domain } : {}),
      path: "/"
    });
  }

  private parseDurationMs(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const match = value.match(/^(\d+)([smhd])$/);
    if (!match) {
      const asNumber = Number(value);
      return Number.isFinite(asNumber) ? asNumber * 1000 : fallback;
    }
    const amount = Number(match[1]);
    const unit = match[2] as "s" | "m" | "h" | "d";
    const multipliers = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000
    };
    return amount * multipliers[unit];
  }
}
