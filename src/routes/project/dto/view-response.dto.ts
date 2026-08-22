import { ApiProperty } from "@nestjs/swagger";

export class ViewResponseDto {
  @ApiProperty({
    example: 128,
    description: "The number of play opens registered for the project"
  })
  viewCount!: number;
}
