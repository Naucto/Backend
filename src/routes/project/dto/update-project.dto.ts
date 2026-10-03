import { ApiProperty } from '@nestjs/swagger';
import { MonetizationType, ProjectStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import {
  PROJECT_LONG_DESC_MAX_LENGTH,
  PROJECT_MAX_TAGS,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_SHORT_DESC_MAX_LENGTH,
} from './project-field-limits';

export class UpdateProjectDto {
  @ApiProperty({
    description: 'The name of the project',
    example: 'MySuperVideoGame',
    maxLength: PROJECT_NAME_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PROJECT_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({
    description: 'A short description of the project',
    example: 'A 2D platformer game with pixel art graphics',
    maxLength: PROJECT_SHORT_DESC_MAX_LENGTH,
  })
  @IsString()
  @MaxLength(PROJECT_SHORT_DESC_MAX_LENGTH)
  shortDesc!: string;

  @ApiProperty({
    description: 'A detailed description of the project',
    example: 'This game features multiple levels, power-ups, and boss fights.',
    required: false,
    type: String,
    nullable: true,
    maxLength: PROJECT_LONG_DESC_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PROJECT_LONG_DESC_MAX_LENGTH)
  longDesc?: string | null;

  @ApiProperty({
    description: 'Tags attached to the project',
    example: ['RPG', 'Adventure'],
    required: false,
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(PROJECT_MAX_TAGS)
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiProperty({
    description: 'Project status',
    enum: ProjectStatus,
    default: ProjectStatus.IN_PROGRESS,
    required: false,
  })
  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  @ApiProperty({
    description: 'Monetization type',
    enum: MonetizationType,
    required: false,
    default: MonetizationType.NONE,
  })
  @IsEnum(MonetizationType)
  @IsOptional()
  monetization?: MonetizationType;

  @ApiProperty({
    description: 'The price of the project',
    example: 99.99,
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;
}
