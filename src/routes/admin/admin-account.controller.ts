import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { RequiresRole } from '../../auth/access/access.decorators';
import { bearerClaims } from '../../auth/access/bearer-claims';
import { ADMIN } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';
import { AdminAccountService } from './admin-account.service';
import { respondWithSession } from './admin-auth.controller';
import {
  AccountSearchQueryDto,
  AccountSearchResultDto,
  AdminAccountDto,
  AdminAccountListDto,
  AdminMeDto,
  SetRoleDto,
  TwoFactorCodeDto,
  TwoFactorConfirmDto,
  TwoFactorSetupDto,
} from './dto/admin-account.dto';
import { AdminSessionDto } from './dto/admin-auth.dto';

@ApiTags('admin')
@Controller('admin/accounts')
@RequiresRole(ADMIN)
export class AdminAccountController {
  constructor(private readonly accounts: AdminAccountService) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in admin, and whether this session passed the code step' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminMeDto })
  me(@Req() req: RequestWithUser): Promise<AdminMeDto> {
    return this.accounts.me(req.user.id, bearerClaims(req)?.mfa === true);
  }

  @Post('me/two-factor/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start enrolling an authenticator: a secret to scan, not yet active' })
  @ApiResponse({ status: HttpStatus.OK, type: TwoFactorSetupDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Already on' })
  startTwoFactor(@Req() req: RequestWithUser): Promise<TwoFactorSetupDto> {
    return this.accounts.startTwoFactor(req.user.id);
  }

  @Post('me/two-factor/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Turn two-factor sign-in on with a first code; answers with a verified session',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AdminSessionDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid code or expired setup' })
  async confirmTwoFactor(
    @Req() req: RequestWithUser,
    @Body() dto: TwoFactorConfirmDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminSessionDto> {
    return respondWithSession(
      res,
      await this.accounts.confirmTwoFactor(req.user.id, dto.setupToken, dto.code),
    );
  }

  @Post('me/two-factor/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Turn two-factor sign-in off, with a current code' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminMeDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid code' })
  disableTwoFactor(
    @Req() req: RequestWithUser,
    @Body() dto: TwoFactorCodeDto,
  ): Promise<AdminMeDto> {
    return this.accounts.disableTwoFactor(req.user.id, dto.code);
  }

  @Get('admins')
  @ApiOperation({ summary: 'Every account holding the admin role' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminAccountListDto })
  admins(): Promise<AdminAccountListDto> {
    return this.accounts.admins();
  }

  @Get('search')
  @ApiOperation({ summary: 'Naucto accounts matching part of a handle, display name or email' })
  @ApiResponse({ status: HttpStatus.OK, type: AccountSearchResultDto })
  search(@Query() query: AccountSearchQueryDto): Promise<AccountSearchResultDto> {
    return this.accounts.search(query.term);
  }

  @Put(':id/role')
  @ApiOperation({ summary: "Change an account's role; never your own, never the last admin" })
  @ApiResponse({ status: HttpStatus.OK, type: AdminAccountDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Your own account' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The last admin' })
  setRole(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRoleDto,
  ): Promise<AdminAccountDto> {
    return this.accounts.setRole(req.user.id, id, dto.role);
  }

  @Post(':id/two-factor/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Turn off another admin's two-factor sign-in, for a lost device" })
  @ApiResponse({ status: HttpStatus.OK, type: AdminAccountDto })
  resetTwoFactor(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AdminAccountDto> {
    return this.accounts.resetTwoFactor(req.user.id, id);
  }
}
