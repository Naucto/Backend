import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresRole } from '../../auth/access/access.decorators';
import { ADMIN } from '../../auth/access/roles';
import { AdminFeedbackService } from './admin-feedback.service';
import {
  AdminCrashDetailDto,
  AdminCrashGroupDto,
  AdminCrashListDto,
  AdminCrashQueryDto,
  UpdateCrashGroupDto,
} from './dto/admin-feedback.dto';

@ApiTags('admin')
@Controller('admin/crashes')
@RequiresRole(ADMIN)
export class AdminCrashController {
  constructor(private readonly feedback: AdminFeedbackService) {}

  @Get()
  @ApiOperation({ summary: 'Crashes grouped by fingerprint' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminCrashListDto })
  crashes(@Query() query: AdminCrashQueryDto): Promise<AdminCrashListDto> {
    return this.feedback.crashes(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One crash group with its latest occurrences' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminCrashDetailDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such crash' })
  crash(@Param('id', ParseIntPipe) id: number): Promise<AdminCrashDetailDto> {
    return this.feedback.crash(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Resolve, ignore or reopen a crash group' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminCrashGroupDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such crash' })
  updateCrash(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCrashGroupDto,
  ): Promise<AdminCrashGroupDto> {
    return this.feedback.updateCrash(id, dto);
  }
}
