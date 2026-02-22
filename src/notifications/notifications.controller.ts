import {
  Body,
  Controller,
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

@ApiTags("notifications")
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // TODO: Remove this endpoint after testing, or restrict it to admin users
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

  @ApiOperation({ summary: "set notifications as read" })
  @ApiResponse({ status: HttpStatus.OK, description: "All notifications as read" })
  @Patch("read-all")
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(
    @Request() req: RequestWithUser,
  ): Promise<{ statusCode: number; message: string; data: { modifiedCount: number } }> {
    const modifiedCount = await this.notificationsService.markAllAsRead(req.user.id);

    return {
      statusCode: HttpStatus.OK,
      message: "All notifications as read",
      data: { modifiedCount },
    };
  }
}
