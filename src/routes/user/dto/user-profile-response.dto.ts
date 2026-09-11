import { ApiProperty } from "@nestjs/swagger";
import { UserResponseDto } from "./user-response.dto";

export class UserProfileResponseDto extends UserResponseDto {
  @ApiProperty({
    description: "User profile message",
    example: "Profile retrieved successfully"
  })
    message?: string;

  @ApiProperty({
    description: "Public CDN URL of the profile image (if any)",
    type: String,
    example: "https://cdn.example.com/users/1/profile?v=abc123",
    nullable: true
  })
    profileImageUrl?: string | null;

  @ApiProperty({
    description: "Public CDN URL of the profile background image (if any)",
    type: String,
    example: "https://cdn.example.com/users/1/background?v=abc123",
    nullable: true
  })
    backgroundImageUrl?: string | null;
}
