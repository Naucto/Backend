import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresRole } from '../../auth/access/access.decorators';
import { ADMIN } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';
import { AdminAccountService } from './admin-account.service';
import {
  AccountSearchQueryDto,
  AccountSearchResultDto,
  AccountSummaryDto,
  AdminAccountListDto,
  SetRoleDto,
} from './dto/admin-account.dto';

@ApiTags('admin')
@Controller('admin/accounts')
@RequiresRole(ADMIN)
export class AdminAccountController {
  constructor(private readonly accounts: AdminAccountService) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in admin' })
  @ApiResponse({ status: HttpStatus.OK, type: AccountSummaryDto })
  me(@Req() req: RequestWithUser): Promise<AccountSummaryDto> {
    return this.accounts.me(req.user.id);
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
  @ApiResponse({ status: HttpStatus.OK, type: AccountSummaryDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Your own account' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The last admin' })
  setRole(
    @Req() req: RequestWithUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRoleDto,
  ): Promise<AccountSummaryDto> {
    return this.accounts.setRole(req.user.id, id, dto.role);
  }
}
