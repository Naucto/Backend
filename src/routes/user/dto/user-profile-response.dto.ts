import { ApiProperty } from "@nestjs/swagger";
import { UserResponseDto } from "./user-response.dto";

export class UserProfileResponseDto extends UserResponseDto {
  @ApiProperty({
    description: "User profile message",
    example: "Profile retrieved successfully"
  })
  message?: string;
}
