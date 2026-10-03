import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Min } from "class-validator";

export class KickWorkSessionDto {
  @ApiProperty({
    description: "The ID of the user participating in the work session",
    example: 1
  })
  @IsInt()
  @Min(1)
    userId!: number;
}
