import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';

import { Public } from '../../auth/access/access.decorators';
import { AdminSessionService, IssuedSession } from './admin-session.service';
import { ADMIN_SESSION_COOKIE, adminSessionCookieOptions } from './admin-session-cookie';
import { AdminLoginDto, AdminSessionDto, AdminTwoFactorLoginDto } from './dto/admin-auth.dto';

/** Writes the session cookie when one was issued, and answers with the body alone. */
export function respondWithSession(res: Response, issued: IssuedSession): AdminSessionDto {
  if (issued.sessionToken) {
    res.cookie(ADMIN_SESSION_COOKIE, issued.sessionToken, adminSessionCookieOptions(true));
  }
  return issued.session;
}

@ApiTags('admin')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly sessions: AdminSessionService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in to the admin panel; asks for the authenticator code when it is enabled',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AdminSessionDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid email or password' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not an admin account' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many failed attempts' })
  async login(
    @Body() dto: AdminLoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSessionDto> {
    return respondWithSession(res, await this.sessions.login(dto.email, dto.password, ip));
  }

  @Public()
  @Post('two-factor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finish signing in with the authenticator code' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminSessionDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid code or expired step' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many failed codes' })
  async twoFactor(
    @Body() dto: AdminTwoFactorLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSessionDto> {
    return respondWithSession(
      res,
      await this.sessions.completeTwoFactor(dto.challengeToken, dto.code),
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A new access token from the session cookie, until the session ends' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminSessionDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'No session, or it ended' })
  async refresh(@Req() req: Request): Promise<AdminSessionDto> {
    const token = (req.cookies as Record<string, string | undefined>)[ADMIN_SESSION_COOKIE];
    if (!token) {
      throw new UnauthorizedException('Not signed in');
    }
    return (await this.sessions.refresh(token)).session;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End the admin session in this browser' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(ADMIN_SESSION_COOKIE, adminSessionCookieOptions(false));
  }
}
