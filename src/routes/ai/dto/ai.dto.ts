import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBase64,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** What AI can have made of a game, for the badge a release carries. */
export const AI_CATEGORIES = ['CODE', 'SPRITES', 'MAPS', 'MUSIC', 'SFX', 'MULTIPLAYER'] as const;
export type AiCategory = (typeof AI_CATEGORIES)[number];

/** Which state of a project the assistant reads. */
export const AI_SAVE_SOURCES = ['draft', 'base', 'latest'] as const;
export type AiSaveSource = (typeof AI_SAVE_SOURCES)[number];

export class AiDeviceRequestDto {
  @ApiPropertyOptional({ example: 'Claude Code on my laptop', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  clientName?: string;
}

/** RFC 8628's answer, in its own field names, which OAuth clients read as they are. */
export class AiDeviceAuthorizationDto {
  @ApiProperty() device_code!: string;
  @ApiProperty({ example: 'ACDE-FGHJ' }) user_code!: string;
  @ApiProperty() verification_uri!: string;
  @ApiProperty() verification_uri_complete!: string;
  @ApiProperty() expires_in!: number;
  @ApiProperty() interval!: number;
}

export const AI_GRANT_TYPES = [
  'urn:ietf:params:oauth:grant-type:device_code',
  'refresh_token',
] as const;

export class AiTokenRequestDto {
  @ApiProperty({ enum: AI_GRANT_TYPES })
  @IsIn(AI_GRANT_TYPES)
  grant_type!: (typeof AI_GRANT_TYPES)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) device_code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) refresh_token?: string;
}

export class AiTokenDto {
  @ApiProperty() access_token!: string;
  @ApiProperty() refresh_token!: string;
  @ApiProperty({ enum: ['Bearer'] }) token_type!: 'Bearer';
  @ApiProperty({ description: 'Seconds the access token lasts' }) expires_in!: number;
}

export const AI_TOKEN_ERRORS = [
  'authorization_pending',
  'slow_down',
  'access_denied',
  'expired_token',
  'invalid_grant',
  'invalid_request',
] as const;
export type AiTokenErrorCode = (typeof AI_TOKEN_ERRORS)[number];

export class AiTokenErrorDto {
  @ApiProperty({ enum: AI_TOKEN_ERRORS }) error!: AiTokenErrorCode;
  @ApiProperty() error_description!: string;
}

export class AiDeviceDescriptionDto {
  @ApiProperty() clientName!: string;
  @ApiProperty() expiresAt!: Date;
}

export class AiGrantDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: Date, nullable: true }) lastUsedAt!: Date | null;
}

export class AiConnectionDto {
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: Date, nullable: true }) expiresAt!: Date | null;
}

export class AiReachableProjectDto {
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'When the assistant last wrote its draft',
  })
  draftUpdatedAt!: Date | null;
}

/** A whole Yjs state, as base64. */
const SNAPSHOT = {
  description: 'A whole Yjs state of the game, as base64',
  format: 'byte',
} as const;

export class AiWorkspaceDto {
  @ApiProperty({ description: 'Names the state read; a write must send it back' })
  revision!: number;
  @ApiProperty({
    ...SNAPSHOT,
    type: String,
    nullable: true,
    description: 'What the assistant made; null before it wrote anything',
  })
  draft!: string | null;
  @ApiProperty({
    ...SNAPSHOT,
    type: String,
    nullable: true,
    description: 'The user state the draft was made from',
  })
  base!: string | null;
  @ApiProperty({ type: Date, nullable: true }) updatedAt!: Date | null;
}

export class AiWorkspaceReviewDto {
  @ApiProperty() @IsInt() @Min(0) revision!: number;

  @ApiProperty({ ...SNAPSHOT, description: 'The open document once the kept changes are in it' })
  @IsBase64()
  base!: string;

  @ApiProperty({
    ...SNAPSHOT,
    description: 'The same, with the changes still waiting: the next draft',
  })
  @IsBase64()
  draft!: string;

  @ApiProperty({ enum: AI_CATEGORIES, isArray: true, description: 'What the kept changes touched' })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(AI_CATEGORIES.length)
  @IsIn(AI_CATEGORIES, { each: true })
  categories!: AiCategory[];
}

export class AiSaveQueryDto {
  @ApiPropertyOptional({ enum: AI_SAVE_SOURCES, default: 'draft' })
  @IsOptional()
  @IsIn(AI_SAVE_SOURCES)
  source?: AiSaveSource;
}

export class AiSaveDto {
  @ApiProperty({ enum: AI_SAVE_SOURCES }) source!: AiSaveSource;
  @ApiProperty() revision!: number;
  @ApiProperty(SNAPSHOT) snapshot!: string;
  @ApiProperty({ type: Date, nullable: true }) updatedAt!: Date | null;
}

export class AiSaveWriteDto {
  @ApiProperty() @IsInt() @Min(0) revision!: number;

  @ApiProperty(SNAPSHOT) @IsBase64() snapshot!: string;

  @ApiPropertyOptional({
    ...SNAPSHOT,
    description: 'A new base, after the draft took in a user save',
  })
  @IsOptional()
  @IsBase64()
  base?: string;
}

export class AiJobCreateDto {
  @ApiProperty({ example: 'sprite' }) @IsString() @MaxLength(40) kind!: string;
  @ApiProperty({ type: Object }) @IsObject() request!: Record<string, unknown>;
}

export class AiJobCompleteDto {
  @ApiProperty({ type: Object }) @IsObject() result!: Record<string, unknown>;
  @ApiProperty() @IsString() @MaxLength(200) model!: string;
}

export class AiJobFailDto {
  @ApiProperty() @IsString() @MaxLength(300) error!: string;
}

export class AiJobDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty({ enum: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] }) state!: string;
  @ApiProperty({ type: Object }) request!: unknown;
  @ApiProperty({ type: Object, nullable: true }) result!: unknown;
  @ApiProperty({ type: String, nullable: true }) error!: string | null;
  @ApiProperty({ type: String, nullable: true }) model!: string | null;
  @ApiProperty() cancelRequested!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class AiDeclarationCreateDto {
  @ApiProperty({ enum: AI_CATEGORIES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(AI_CATEGORIES.length)
  @IsIn(AI_CATEGORIES, { each: true })
  categories!: AiCategory[];

  @ApiProperty({ maxLength: 1000 }) @IsString() @MaxLength(1000) note!: string;
}

export class AiDeclarationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: AI_CATEGORIES, isArray: true }) categories!: string[];
  @ApiProperty() note!: string;
  @ApiProperty() createdAt!: Date;
}

export class AiProvenanceDto {
  @ApiProperty({ enum: AI_CATEGORIES, isArray: true }) categories!: string[];
  @ApiProperty({ type: [AiDeclarationDto] }) declarations!: AiDeclarationDto[];
}

export class AiJobStartDto {
  @ApiProperty() run!: boolean;
}
