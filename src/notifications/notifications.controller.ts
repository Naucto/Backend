import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresAuth } from '../auth/access/access.decorators';
import { RequestWithUser } from '../auth/auth.types';
import {
  NotificationOfferResponseDto,
  NotificationResponseDto,
  NotificationsReadAllResponseDto,
} from './dto/notification-response.dto';
import { NotificationTestDto } from './dto/notification-test.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@RequiresAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({ summary: 'Get notification websocket configuration' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification websocket configuration',
    type: NotificationOfferResponseDto,
  })
  @Get('webrtc-offer')
  getWebRTCOffer(): NotificationOfferResponseDto {
    return {
      statusCode: HttpStatus.OK,
      message: 'Notification websocket configuration retrieved',
      data: this.notificationsService.getWebRTCOffer(),
    };
  }

  @ApiOperation({ summary: 'Send a test notification to the current user' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification created and sent',
    type: NotificationResponseDto,
  })
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async sendTestNotification(
    @Request() req: RequestWithUser,
    @Body() body: NotificationTestDto,
  ): Promise<NotificationResponseDto> {
    const payload = await this.notificationsService.createNotification({
      userId: req.user.id,
      title: body.title,
      message: body.message,
      type: body.type,
    });

    return {
      statusCode: HttpStatus.OK,
      message: 'Notification sent',
      data: payload,
    };
  }

  @ApiOperation({ summary: 'Mark every unread notification of the current user as read' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Number of notifications marked as read',
    type: NotificationsReadAllResponseDto,
  })
  @Patch('read-all')
  async markAllAsRead(@Request() req: RequestWithUser): Promise<NotificationsReadAllResponseDto> {
    const count = await this.notificationsService.markAllAsRead(req.user.id);

    return {
      statusCode: HttpStatus.OK,
      message: 'Notifications marked as read',
      data: { count },
    };
  }

  @ApiOperation({ summary: 'set one notification as read' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification marked as read',
    type: NotificationResponseDto,
  })
  @Patch(':id/read')
  async markAsRead(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
  ): Promise<NotificationResponseDto> {
    const payload = await this.notificationsService.markAsRead(req.user.id, id);

    return {
      statusCode: HttpStatus.OK,
      message: 'Notification marked as read',
      data: payload,
    };
  }
}
