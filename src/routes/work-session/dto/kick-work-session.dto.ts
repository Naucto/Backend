import { ApiProperty } from "@nestjs/swagger";
import { IsNumber } from "class-validator";

export class KickWorkSessionDto {
  @ApiProperty({
    description: "The ID of the user participating in the work session",
    example: 1
  })
  @IsNumber()
  userId!: number;
}
