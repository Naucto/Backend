import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsDate, IsString, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWorkSessionDto {
  @ApiProperty({
    description: 'The ID of the project this work session belongs to',
    example: 1,
  })
  @IsInt()
  projectId: number;

  @ApiProperty({
    description: 'The start time of the work session',
    example: '2023-04-15T12:00:00Z',
    required: false,
  })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  startTime?: Date;

  @ApiProperty({
    description: 'The end time of the work session',
    example: '2023-04-15T14:30:00Z',
    required: false,
  })
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  endTime?: Date;

  @ApiProperty({
    description: 'Notes about the work session',
    example: 'Completed the login functionality',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    description: 'Duration in minutes (can be calculated from start/end times)',
    example: 120,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  durationMinutes?: number;
}