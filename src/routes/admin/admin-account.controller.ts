import { Body, Controller, Get, HttpStatus, Param, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresStaffSession } from '../../auth/access/access.decorators';
import { ADMIN, parseRole, VIEWER } from '../../auth/access/roles';
import { RequestWithUser } from '../../auth/auth.types';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
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
@RequiresStaffSession(ADMIN)
export class AdminAccountController {
  constructor(private readonly accounts: AdminAccountService) {}

  @Get('me')
  @RequiresStaffSession(VIEWER)
  @ApiOperation({ summary: 'The signed-in staff member' })
  @ApiResponse({ status: HttpStatus.OK, type: AccountSummaryDto })
  me(@Req() req: RequestWithUser): Promise<AccountSummaryDto> {
    return this.accounts.me(req.user.id);
  }

  @Get('admins')
  @ApiOperation({ summary: 'Every account holding the admin role' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminAccountListDto })
  admins(@Req() req: RequestWithUser): Promise<AdminAccountListDto> {
    return this.accounts.admins(parseRole(req.user.role));
  }

  @Get('staff')
  @ApiOperation({ summary: 'Every account holding a role that signs in to the console' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminAccountListDto })
  staff(@Req() req: RequestWithUser): Promise<AdminAccountListDto> {
    return this.accounts.staff(parseRole(req.user.role));
  }

  @Get('search')
  @ApiOperation({ summary: 'Naucto accounts matching part of a handle, display name or email' })
  @ApiResponse({ status: HttpStatus.OK, type: AccountSearchResultDto })
  search(
    @Req() req: RequestWithUser,
    @Query() query: AccountSearchQueryDto,
  ): Promise<AccountSearchResultDto> {
    return this.accounts.search(query.term, parseRole(req.user.role));
  }

  @Put(':id/role')
  @ApiOperation({ summary: "Change an account's role; never your own, never the last admin" })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: AccountSummaryDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Your own account' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The last admin' })
  setRole(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() dto: SetRoleDto,
  ): Promise<AccountSummaryDto> {
    return this.accounts.setRole(req.user.id, id, dto.role);
  }
}
