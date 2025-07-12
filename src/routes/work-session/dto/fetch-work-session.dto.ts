import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsDate, IsNumber, IsString } from "class-validator";

export class FetchWorkSessionDto {
  @ApiProperty({
    description: "The ID of the user participating in the work session",
    example: [1, 2, 3],
  })
  @IsArray()
    users!: number[];

  @ApiProperty({
    description: "The ID of the session's host",
    example: 1,
  })
  @IsNumber()
    host!: number;

  @ApiProperty({
    description: "The ID of the project this work session belongs to",
    example: 1,
  })
  @IsNumber()
    project!: number;

  @ApiProperty({
    description: "The date and time when the work session started",
    example: "2023-04-15T12:00:00Z",
  })
  @IsDate()
    startedAt!: Date;

  @ApiProperty({
    description: "The ID of the room for this work session",
    example: "room-12345",
  })
  @IsString()
    roomId!: string;

  @ApiProperty({
    description: "The password for the room of this work session",
    example: "password123",
  })
  @IsString()
    roomPassword!: string;
}
