import { ApiProperty } from "@nestjs/swagger";

/**
 * What an upload answers with.
 *
 * The address is here because the picture that was just sent is the one about to be drawn: without
 * it the caller has to ask a second time for something the server already knows.
 */
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
