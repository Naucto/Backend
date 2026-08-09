import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsString, MaxLength } from "class-validator";
import { NOTIFICATION_TYPES, NotificationType } from "../notifications.types";

export class NotificationTestDto {
  @ApiProperty({
    example: "Test Notification",
    description: "The title of the test notification"
  })
  @IsString()
  @MaxLength(120)
    title!: string;

  @ApiProperty({
    example: "This is a test notification message.",
    description: "The message content of the test notification"
  })
  @IsString()
  @MaxLength(500)
    message!: string;

  @ApiProperty({
    example: "INFO",
    description: "The type of the notification",
    enum: NOTIFICATION_TYPES
  })
  @IsEnum(NOTIFICATION_TYPES)
    type!: NotificationType;
}
