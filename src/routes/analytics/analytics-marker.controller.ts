import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresRole } from '../../auth/access/access.decorators';
import { ADMIN } from '../../auth/access/roles';
import { AnalyticsMarkerService } from './analytics-marker.service';
import {
  AnalyticsMarkerDto,
  AnalyticsMarkersDto,
  AnalyticsMarkersQueryDto,
  CreateAnalyticsMarkerDto,
  UpdateAnalyticsMarkerDto,
} from './dto/analytics-marker.dto';

@ApiTags('admin')
@Controller('admin/analytics/markers')
@RequiresRole(ADMIN)
export class AnalyticsMarkerController {
  constructor(private readonly markers: AnalyticsMarkerService) {}

  @Get()
  @ApiOperation({ summary: 'The moments marked on the charts, such as posts going out' })
  @ApiResponse({ status: 200, type: AnalyticsMarkersDto })
  list(@Query() query: AnalyticsMarkersQueryDto): Promise<AnalyticsMarkersDto> {
    return this.markers.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Mark a moment on the charts' })
  @ApiResponse({ status: 201, type: AnalyticsMarkerDto })
  create(@Body() dto: CreateAnalyticsMarkerDto): Promise<AnalyticsMarkerDto> {
    return this.markers.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a marker. Null clears an optional field' })
  @ApiResponse({ status: 200, type: AnalyticsMarkerDto })
  @ApiResponse({ status: 404, description: 'No such marker' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAnalyticsMarkerDto,
  ): Promise<AnalyticsMarkerDto> {
    return this.markers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a marker' })
  @ApiResponse({ status: 204, description: 'Removed' })
  @ApiResponse({ status: 404, description: 'No such marker' })
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.markers.remove(id);
  }
}
