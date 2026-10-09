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
import { AdminSessionService } from './admin-session.service';
import { ADMIN_SESSION_COOKIE, adminSessionCookieOptions } from './admin-session-cookie';
import { AdminLoginDto, AdminSessionDto } from './dto/admin-auth.dto';

@ApiTags('admin')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly sessions: AdminSessionService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in to the admin console with an admin account' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminSessionDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid email or password' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not an admin account' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many failed attempts' })
  async login(
    @Body() dto: AdminLoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSessionDto> {
    const issued = await this.sessions.login(dto.email, dto.password, ip);
    if (issued.sessionToken) {
      res.cookie(ADMIN_SESSION_COOKIE, issued.sessionToken, adminSessionCookieOptions(true));
    }
    return issued.session;
  }

  /**
   * The console asks this on every load, so having no session is an answer rather than an error.
   * A cookie that no longer opens a session is cleared, so the browser stops sending it.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A new access token from the session cookie, until the session ends' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminSessionDto })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'No session, or it ended' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSessionDto | undefined> {
    const token = (req.cookies as Record<string, string | undefined>)[ADMIN_SESSION_COOKIE];
    if (token) {
      try {
        return (await this.sessions.refresh(token)).session;
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) {
          throw error;
        }
        res.clearCookie(ADMIN_SESSION_COOKIE, adminSessionCookieOptions(false));
      }
    }
    res.status(HttpStatus.NO_CONTENT);
    return undefined;
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
