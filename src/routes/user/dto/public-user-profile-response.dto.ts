import { ApiProperty } from "@nestjs/swagger";
import { PublicUserProfileDto } from "./public-user-profile.dto";

export class PublicUserProfileResponseDto {
  @ApiProperty({ description: "HTTP status code", example: 200 })
    statusCode!: number;

  @ApiProperty({
    description: "Response message",
    example: "Public user profile retrieved successfully"
  })
    message!: string;

  @ApiProperty({ description: "Public user profile", type: PublicUserProfileDto })
    data!: PublicUserProfileDto;
}

