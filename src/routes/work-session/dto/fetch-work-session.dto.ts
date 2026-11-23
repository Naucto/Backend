import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsDate, IsString, IsUUID } from 'class-validator';

export class FetchWorkSessionDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'IDs of the users present in the work session',
    example: ['3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b'],
  })
  @IsArray()
  @IsUUID(undefined, { each: true })
  users!: string[];

  @ApiProperty({
    description: "The ID of the session's host",
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
  })
  @IsUUID()
  hostId!: string;

  @ApiProperty({
    description: 'The ID of the project this work session belongs to',
    format: 'uuid',
    example: '8c5d2a7e-41b3-4f6a-9e0d-2b7c6a5f4e3d',
  })
  @IsUUID()
  project!: string;

  @ApiProperty({
    description: 'The date and time when the work session started',
    example: '2023-04-15T12:00:00Z',
  })
  @IsDate()
  startedAt!: Date;

  @ApiProperty({
    description: 'The ID of the room for this work session',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  roomId!: string;
}
