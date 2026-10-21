import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMarkerAudience } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true };

const AUDIENCE_DESCRIPTION =
  'Who it speaks to: players of a game, people making games, or everyone';
const RELEASE_DESCRIPTION =
  'The published project it is about: the game to play, or for creators the game to fork';

export class CreateAnalyticsMarkerDto {
  @ApiProperty({ description: 'When it went out, ISO 8601', example: '2026-10-20T18:00:00Z' })
  @IsISO8601({ strict: true })
  at!: string;

  @ApiProperty({ maxLength: 120, example: 'Launch trailer' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @ApiPropertyOptional({ maxLength: 40, example: 'YouTube' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  channel?: string;

  @ApiPropertyOptional({ maxLength: 2048, description: 'An http or https link to the post' })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({
    enum: AnalyticsMarkerAudience,
    enumName: 'AnalyticsMarkerAudience',
    default: AnalyticsMarkerAudience.EVERYONE,
    description: AUDIENCE_DESCRIPTION,
  })
  @IsOptional()
  @IsEnum(AnalyticsMarkerAudience)
  audience?: AnalyticsMarkerAudience;

  @ApiPropertyOptional({ description: RELEASE_DESCRIPTION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  releaseId?: number;
}

export class UpdateAnalyticsMarkerDto {
  @ApiPropertyOptional({ description: 'ISO 8601' })
  @IsOptional()
  @IsISO8601({ strict: true })
  at?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  channel?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2048 })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(2048)
  url?: string | null;

  @ApiPropertyOptional({
    enum: AnalyticsMarkerAudience,
    enumName: 'AnalyticsMarkerAudience',
    description: AUDIENCE_DESCRIPTION,
  })
  @IsOptional()
  @IsEnum(AnalyticsMarkerAudience)
  audience?: AnalyticsMarkerAudience;

  @ApiPropertyOptional({ type: Number, nullable: true, description: RELEASE_DESCRIPTION })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  releaseId?: number | null;
}

export class AnalyticsMarkerDto {
  @ApiProperty() id!: number;
  @ApiProperty() at!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ type: String, nullable: true }) channel!: string | null;
  @ApiProperty({ type: String, nullable: true }) url!: string | null;
  @ApiProperty({ enum: AnalyticsMarkerAudience, enumName: 'AnalyticsMarkerAudience' })
  audience!: AnalyticsMarkerAudience;
  @ApiProperty({ type: Number, nullable: true }) releaseId!: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'Null for a game since deleted' })
  game!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class AnalyticsMarkersDto {
  @ApiProperty({ type: [AnalyticsMarkerDto], description: 'Oldest first' })
  markers!: AnalyticsMarkerDto[];
}

export class AnalyticsMarkersQueryDto {
  @ApiPropertyOptional({ description: 'First instant, ISO 8601' })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Last instant, ISO 8601, excluded' })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
