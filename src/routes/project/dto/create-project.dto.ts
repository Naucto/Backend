import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsUrl,
  IsEnum,
  Min,
} from 'class-validator';

enum ProjectStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

enum MonetizationType {
  NONE = 'NONE',
  ADS = 'ADS',
  PAID = 'PAID',
}

export class CreateProjectDto {
  @ApiProperty({
    description: 'The name of the project',
    example: 'MySuperVideoGame',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'A short description of the project',
    example: 'A 2D platformer game with pixel art graphics',
  })
  @IsString()
  shortDesc: string;

  @ApiProperty({
    description: 'A detailed description of the project',
    example: 'This game features multiple levels, power-ups, and boss fights.',
    required: false,
  })
  @IsString()
  longDesc?: string | null;

  @ApiProperty({
    description: 'URL to the project icon',
    example: 'https://example.com/icons/MySuperVideoGame.png',
    required: false,
  })
  @IsUrl()
  @IsOptional()
  iconUrl?: string;

  @ApiProperty({
    description: 'The file name associated with the project',
    required: false,
  })
  @IsString()
  fileName?: string;

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
