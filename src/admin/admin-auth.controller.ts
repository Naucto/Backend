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

/** The fields every admin-facing identity response is built from. */
type StaffUser = Pick<
  AdminMeDto,
  "id" | "email" | "username" | "accountStatus"
> & { nickname?: string | null };

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
    const me = await this.describeStaff(user, {
      onDenied: (roles) =>
        this.logger.warn(
          `Non-staff user ${user.email} attempted admin login (roles=${roles.join(",")})`
        )
    });

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const tokens = await this.authService.generateAdminTokens(payload, user.id);

    this.setAdminCookies(
      res,
      tokens.access_token,
      tokens.refresh_token,
      tokens.access_token_max_age_ms,
      tokens.refresh_token_max_age_ms
    );

    return me;
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate the admin access token via refresh cookie" })
  @ApiResponse({ status: HttpStatus.OK, type: AdminMeDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED })
  @ApiResponse({ status: HttpStatus.FORBIDDEN })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<AdminMeDto> {
    const refreshToken = this.readCookie(req, REFRESH_COOKIE);
    if (!refreshToken) {
      throw new UnauthorizedException("Admin refresh token missing");
    }

    const tokens = await this.authService.refreshAdminTokens(refreshToken);
    const user = await this.userService.findOne(tokens.userId);

    // Staff access can be revoked mid-session; re-check on every rotation so a
    // demoted moderator loses the panel at the next refresh instead of at expiry.
    let me: AdminMeDto;
    try {
      me = await this.describeStaff(user);
    } catch (err) {
      this.clearAdminCookies(res);
      throw err;
    }

    this.setAdminCookies(
      res,
      tokens.access_token,
      tokens.refresh_token,
      tokens.access_token_max_age_ms,
      tokens.refresh_token_max_age_ms
    );

    return me;
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
    const refreshToken = this.readCookie(req, REFRESH_COOKIE);
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
    return this.describeStaff(req.user);
  }

  private readCookie(req: Request, name: string): string | undefined {
    return (req as Request & { cookies?: Record<string, string> }).cookies?.[
      name
    ];
  }

  /**
   * Resolves a user's roles, rejects non-staff, and shapes the `AdminMeDto` that
   * login, refresh, and `me` all return -- so the three cannot drift on which
   * roles count as staff or on what the panel receives.
   */
  private async describeStaff(
    user: StaffUser,
    options?: { onDenied?: (roles: string[]) => void }
  ): Promise<AdminMeDto> {
    const roles = await this.userService.getUserRoles(user.id);
    const isStaff = roles.some((role) =>
      (STAFF_ROLES as readonly string[]).includes(role)
    );

    if (!isStaff) {
      options?.onDenied?.(roles);
      throw new ForbiddenException("Staff access required");
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname ?? null,
      accountStatus: user.accountStatus,
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
}
