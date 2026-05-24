import {
  Controller,
  Post,
  Patch,
  Body,
  Req,
  Res,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import {
  LoginDto,
  GoogleCodeDto,
  GithubLoginDto,
  MicrosoftLoginDto
} from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { CreateUserDto } from "@user/dto/create-user.dto";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBody,
  ApiBearerAuth
} from "@nestjs/swagger";
import { Response, Request, CookieOptions } from "express";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RequestWithUser } from "./auth.types";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  private readonly isProd = process.env["NODE_ENV"] === "production";

  constructor(private readonly authService: AuthService) {}

  private getRefreshCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.isProd,
      sameSite: this.isProd ? "none" : "lax",
      path: "/auth/refresh"
    };
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie("refresh_token", token, {
      ...this.getRefreshCookieOptions(),
      maxAge: this.authService.getRefreshTokenMaxAgeMs()
    });
  }

  @Post("login")
  @ApiOperation({ summary: "Authenticate a user and return an access token" })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 201,
    description: "User logged in successfully",
    schema: {
      type: "object",
      properties: { access_token: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." } },
      required: ["access_token"]
    }
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ access_token: string }> {
    const { access_token, refresh_token } = await this.authService.login(
      loginDto.email,
      loginDto.password
    );

    this.setRefreshCookie(res, refresh_token);

    return { access_token };
  }

  @Post("register")
  @ApiOperation({ summary: "Register a new user and return an access token" })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: 201,
    description: "User registered successfully",
    schema: {
      type: "object",
      properties: { access_token: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." } },
      required: ["access_token"]
    }
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  @ApiResponse({ status: 409, description: "Email already in use" })
  @ApiResponse({ status: 403, description: "Cannot register as an admin" })
  async register(
    @Body() createUserDto: CreateUserDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ access_token: string }> {
    const { access_token, refresh_token } =
      await this.authService.register(createUserDto);

    this.setRefreshCookie(res, refresh_token);

    return { access_token };
  }

  @Post("google/code")
  @ApiOperation({ summary: "Authenticate with Google authorization code + PKCE" })
  @ApiBody({ type: GoogleCodeDto })
  @ApiResponse({
    status: 201,
    description: "Login successful with Google",
    schema: {
      type: "object",
      properties: { access_token: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." } },
      required: ["access_token"]
    }
  })
  @ApiResponse({ status: 401, description: "Invalid Google code or code_verifier" })
  async loginWithGoogleCode(
    @Body() dto: GoogleCodeDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ access_token: string }> {
    const { access_token, refresh_token } =
      await this.authService.loginWithGoogleCode(dto.code, dto.codeVerifier);

    this.setRefreshCookie(res, refresh_token);

    return { access_token };
  }

  @Post("github")
  @ApiOperation({
    summary: "Authenticate with GitHub OAuth authorization code"
  })
  @ApiBody({ type: GithubLoginDto })
  @ApiResponse({
    status: 201,
    description: "Login successful with GitHub",
    schema: {
      type: "object",
      properties: { access_token: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." } },
      required: ["access_token"]
    }
  })
  @ApiResponse({ status: 401, description: "Invalid or expired GitHub code" })
  async loginWithGithub(
    @Body() githubLoginDto: GithubLoginDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ access_token: string }> {
    const { access_token, refresh_token } =
      await this.authService.loginWithGithub(githubLoginDto.code);

    this.setRefreshCookie(res, refresh_token);

    return { access_token };
  }

  @Post("microsoft")
  @ApiOperation({
    summary: "Authenticate with Microsoft ID token"
  })
  @ApiBody({ type: MicrosoftLoginDto })
  @ApiResponse({
    status: 201,
    description: "Login successful with Microsoft",
    schema: {
      type: "object",
      properties: { access_token: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." } },
      required: ["access_token"]
    }
  })
  @ApiResponse({
    status: 401,
    description: "Invalid Microsoft ID token"
  })
  async loginWithMicrosoft(
    @Body() microsoftLoginDto: MicrosoftLoginDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ access_token: string }> {
    const { access_token, refresh_token } =
      await this.authService.loginWithMicrosoft(microsoftLoginDto.token);

    this.setRefreshCookie(res, refresh_token);

    return { access_token };
  }

  @Post("refresh")
  @ApiOperation({
    summary: "Refresh the access token using refresh token cookie"
  })
  @ApiResponse({
    status: 201,
    description: "Access token refreshed successfully",
    schema: {
      type: "object",
      properties: { access_token: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." } },
      required: ["access_token"]
    }
  })
  @ApiResponse({ status: 401, description: "Refresh token missing or invalid" })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ access_token: string }> {
    const refresh_token = req.cookies["refresh_token"];
    if (!refresh_token)
      throw new UnauthorizedException("Refresh token missing");

    const { access_token, refresh_token: new_refresh_token } =
      await this.authService.refreshToken(refresh_token);

    this.setRefreshCookie(res, new_refresh_token);

    return { access_token };
  }

  @Patch("password")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary:
      "Change password, OAuth users can set one without providing a current password"
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: "Password updated successfully" })
  @ApiResponse({
    status: 400,
    description: "Current password required for non-OAuth accounts"
  })
  @ApiResponse({ status: 401, description: "Current password incorrect" })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: RequestWithUser
  ): Promise<{ success: boolean }> {
    await this.authService.changePassword(
      req.user.id,
      dto.newPassword,
      dto.currentPassword
    );
    return { success: true };
  }

  @Post("logout")
  @ApiOperation({ summary: "Remove refresh token cookie" })
  @ApiResponse({
    status: 200,
    description: "Logout successful",
    schema: { example: { success: true } }
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ success: boolean }> {
    const refresh_token = req.cookies["refresh_token"];
    if (refresh_token) {
      await this.authService.revokeRefreshToken(refresh_token);
      res.clearCookie("refresh_token", this.getRefreshCookieOptions());
    }
    return { success: true };
  }
}
