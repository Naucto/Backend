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
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RequestWithUser } from "@auth/auth.types";
import { NotificationTestDto } from "./dto/notification-test.dto";
import { NotificationsService } from "./notifications.service";
import { NotificationPayload } from "./notifications.types";
import { WebRTCOfferDto } from "@webrtc/webrtc.dto";

@ApiTags("notifications")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({ summary: "Get notification websocket configuration" })
  @ApiResponse({ status: HttpStatus.OK, description: "Notification websocket configuration" })
  @Get("webrtc-offer")
  getWebRTCOffer(): { statusCode: number; message: string; data: WebRTCOfferDto } {
    return {
      statusCode: HttpStatus.OK,
      message: "Notification websocket configuration retrieved",
      data: this.notificationsService.getWebRTCOffer()
    };
  }

  @ApiOperation({ summary: "Send a test notification to the current user" })
  @ApiResponse({ status: HttpStatus.OK, description: "Notification created and sent" })
  @Post("test")
  @HttpCode(HttpStatus.OK)
  async sendTestNotification(
    @Request() req: RequestWithUser,
    @Body(ValidationPipe) body: NotificationTestDto,
  ): Promise<{ statusCode: number; message: string; data: NotificationPayload }> {
    const payload = await this.notificationsService.createNotification({
      userId: req.user.id,
      title: body.title,
      message: body.message,
      type: body.type,
    });

    return {
      statusCode: HttpStatus.OK,
      message: "Notification sent",
      data: payload,
    };
  }

  @ApiOperation({ summary: "set one notification as read" })
  @ApiResponse({ status: HttpStatus.OK, description: "Notification marked as read" })
  @Patch(":id/read")
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ): Promise<{ statusCode: number; message: string; data: NotificationPayload }> {
    const payload = await this.notificationsService.markAsRead(req.user.id, id);

    return {
      statusCode: HttpStatus.OK,
      message: "Notification marked as read",
      data: payload,
    };
  }
}
