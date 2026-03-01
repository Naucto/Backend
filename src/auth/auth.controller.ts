import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { AuthResponseDto } from "./dto/auth-response.dto";
import { CreateUserDto } from "@user/dto/create-user.dto";
import { ApiOperation, ApiResponse, ApiTags, ApiBody } from "@nestjs/swagger";
import { Response, Request } from "express";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(res: Response, token: string): void {
    const nodeEnv = process.env["NODE_ENV"] ?? "development";
    res.cookie("refresh_token", token, {
      httpOnly: true,
      secure: nodeEnv === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  }

  @Post("login")
  @ApiOperation({ summary: "Authenticate a user and return an access token" })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 201,
    description: "User registered successfully",
    type: AuthResponseDto
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  @ApiResponse({ status: 403, description: "Cannot register as an admin" })
  @ApiResponse({ status: 409, description: "Email or username already in use" })
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
    type: AuthResponseDto
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

  @Post("google")
  @ApiOperation({ summary: "Authenticate with Google OAuth token" })
  @ApiBody({ schema: { properties: { token: { type: "string" } } } })
  @ApiResponse({
    status: 201,
    description: "Login successful with Google",
    type: AuthResponseDto
  })
  @ApiResponse({ status: 400, description: "Invalid Google token" })
  async loginWithGoogle(
    @Body("token") token: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ access_token: string }> {
    const { access_token, refresh_token } =
      await this.authService.loginWithGoogle(token);

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
    type: AuthResponseDto
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
      const nodeEnv = process.env["NODE_ENV"] ?? "development";

      res.clearCookie("refresh_token", {
        httpOnly: true,
        secure: nodeEnv === "production",
        sameSite: "lax"
      });
    }
    return { success: true };
  }
}
