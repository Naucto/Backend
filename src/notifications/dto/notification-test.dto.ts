import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength } from "class-validator";

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
    example: "notification",
    description: "The type of the notification (friend request, message, etc.)"
  })
  @IsString()
  @MaxLength(100)
    type!: string;
}
