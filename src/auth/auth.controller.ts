import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';

import {
  ConflictErrorResponseDto,
  ValidationErrorResponseDto,
} from '../common/validation/error-response.dto';
import { CreateUserDto } from '../routes/user/dto/create-user.dto';
import { Public, RequiresAuth } from './access/access.decorators';
import { AuthService } from './auth.service';
import { RequestWithUser } from './auth.types';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from './auth.utils';
import { AccessTokenResponseDto, AuthResponseDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { GithubLoginDto, GoogleCodeDto, LoginDto, MicrosoftLoginDto } from './dto/login.dto';
import { PasswordPolicyDto } from './dto/password-policy.dto';
import { PASSWORD_POLICY } from './password-policy';
import { decryptRefreshToken, encryptRefreshToken } from './refresh-cookie.crypto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, encryptRefreshToken(token), {
      ...refreshCookieOptions(),
      maxAge: this.authService.getRefreshTokenMaxAgeMs(),
    });
  }

  /** Hands a freshly minted pair out: the refresh token as a cookie, the access token in the body. */
  private issue(res: Response, pair: AuthResponseDto): AccessTokenResponseDto {
    this.setRefreshCookie(res, pair.refresh_token);
    return { access_token: pair.access_token };
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Authenticate a user and return an access token' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 201,
    description: 'User logged in successfully',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDto> {
    return this.issue(res, await this.authService.login(loginDto.email, loginDto.password));
  }

  @Public()
  @Get('password-policy')
  @ApiOperation({
    summary: 'The password rule this deployment enforces, so a form can enforce the same one',
  })
  @ApiResponse({ status: HttpStatus.OK, type: PasswordPolicyDto })
  getPasswordPolicy(): PasswordPolicyDto {
    return {
      minLength: PASSWORD_POLICY.minLength,
      minCharacterClasses: PASSWORD_POLICY.minCharacterClasses,
      // A copy, so the response never aliases the array the validators read.
      characterClasses: [...PASSWORD_POLICY.characterClasses],
    };
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user and return an access token' })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request', type: ValidationErrorResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Email or username already in use',
    type: ConflictErrorResponseDto,
  })
  async register(
    @Body() createUserDto: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDto> {
    return this.issue(res, await this.authService.register(createUserDto));
  }

  @Public()
  @Post('google/code')
  @ApiOperation({ summary: 'Authenticate with Google authorization code + PKCE' })
  @ApiBody({ type: GoogleCodeDto })
  @ApiResponse({
    status: 201,
    description: 'Login successful with Google',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid Google code or code_verifier' })
  async loginWithGoogleCode(
    @Body() dto: GoogleCodeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDto> {
    return this.issue(
      res,
      await this.authService.loginWithProvider('google', {
        code: dto.code,
        codeVerifier: dto.codeVerifier,
      }),
    );
  }

  @Public()
  @Post('github')
  @ApiOperation({
    summary: 'Authenticate with GitHub OAuth authorization code',
  })
  @ApiBody({ type: GithubLoginDto })
  @ApiResponse({
    status: 201,
    description: 'Login successful with GitHub',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired GitHub code' })
  async loginWithGithub(
    @Body() githubLoginDto: GithubLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDto> {
    return this.issue(res, await this.authService.loginWithProvider('github', githubLoginDto.code));
  }

  @Public()
  @Post('microsoft')
  @ApiOperation({
    summary: 'Authenticate with Microsoft ID token',
  })
  @ApiBody({ type: MicrosoftLoginDto })
  @ApiResponse({
    status: 201,
    description: 'Login successful with Microsoft',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid Microsoft ID token',
  })
  async loginWithMicrosoft(
    @Body() microsoftLoginDto: MicrosoftLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDto> {
    return this.issue(
      res,
      await this.authService.loginWithProvider('microsoft', microsoftLoginDto.token),
    );
  }

  @Public()
  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh the access token using refresh token cookie',
  })
  @ApiResponse({
    status: 201,
    description: 'Access token refreshed successfully',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Refresh token missing or invalid' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDto> {
    const refreshCookie = req.cookies[REFRESH_COOKIE_NAME];
    if (!refreshCookie) {
      throw new UnauthorizedException('Refresh token missing');
    }

    let refresh_token: string;
    try {
      refresh_token = decryptRefreshToken(refreshCookie);
    } catch {
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issue(res, await this.authService.refreshToken(refresh_token));
  }

  @Patch('password')
  @RequiresAuth()
  @ApiOperation({
    summary: 'Change password, OAuth users can set one without providing a current password',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: 'Password updated successfully' })
  @ApiResponse({
    status: 400,
    description: 'Current password required for non-OAuth accounts',
  })
  @ApiResponse({ status: 401, description: 'Current password incorrect' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    const { refresh_token } = await this.authService.changePassword(
      req.user.id,
      dto.newPassword,
      dto.currentPassword,
    );

    this.setRefreshCookie(res, refresh_token);

    return { success: true };
  }

  /**
   * The refresh cookie is scoped to the refresh route and never reaches this one, so the session
   * is revoked by authenticated user rather than by presented token.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @RequiresAuth()
  @ApiOperation({ summary: 'End the session and clear the refresh token cookie' })
  @ApiResponse({
    status: 200,
    description: 'Logout successful',
    schema: { example: { success: true } },
  })
  async logout(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    await this.authService.revokeAllRefreshTokens(req.user.id);
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
    return { success: true };
  }
}
