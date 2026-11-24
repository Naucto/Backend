import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsMarkerAudience } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

import { IsId } from '../../../common/decorators/is-id';

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

  @ApiPropertyOptional({ format: 'uuid', description: RELEASE_DESCRIPTION })
  @IsOptional()
  @IsId()
  releaseId?: string;
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

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: RELEASE_DESCRIPTION,
  })
  @IsOptional()
  @IsId()
  releaseId?: string | null;
}

export class AnalyticsMarkerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() at!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ type: String, nullable: true }) channel!: string | null;
  @ApiProperty({ type: String, nullable: true }) url!: string | null;
  @ApiProperty({ enum: AnalyticsMarkerAudience, enumName: 'AnalyticsMarkerAudience' })
  audience!: AnalyticsMarkerAudience;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) releaseId!: string | null;
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
