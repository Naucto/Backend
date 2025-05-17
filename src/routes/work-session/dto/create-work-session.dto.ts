import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsDate,
  IsString,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWorkSessionDto {
  @ApiProperty({
    description: 'The ID of the project this work session belongs to',
    example: 1,
  })
  @IsInt()
  projectId: number;

  @IsOptional()
  @IsDate()
  startTime?: Date;
}
