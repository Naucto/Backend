import { ApiProperty } from "@nestjs/swagger";

export class ProfileImageRemovedResponseDto {
  @ApiProperty({ example: "Profile picture removed successfully" })
    message!: string;

  @ApiProperty({ description: "User ID", example: 12 })
    id!: number;
}
