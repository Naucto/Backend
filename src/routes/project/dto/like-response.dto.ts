import { ApiProperty } from "@nestjs/swagger";

export class LikeResponseDto {
  @ApiProperty({
    example: 42,
    description: "Total number of likes on the project"
  })
  likes!: number;

  @ApiProperty({
    example: true,
    description: "Whether the current user has liked this project"
  })
  liked!: boolean;
}
