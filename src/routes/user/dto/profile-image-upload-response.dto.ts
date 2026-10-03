import { ApiProperty } from "@nestjs/swagger";

export class ProfileImageUploadResponseDto {
  @ApiProperty({ example: "Profile picture uploaded successfully" })
    message!: string;

  @ApiProperty({ description: "User ID", example: 12 })
    id!: number;

  @ApiProperty({
    description: "Where the image now lives, versioned so a replacement is not served from cache",
    example: "https://cdn.example/users/12/profile?v=abc"
  })
    resourceUrl!: string;
}
