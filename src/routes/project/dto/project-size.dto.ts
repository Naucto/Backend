import { HttpStatus } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

import { PROJECT_BLOB_MAX_BYTES, PROJECT_CONTENT_MAX_BYTES } from '../content-size';
import { CHECKPOINT_LIMIT_CODE, PROJECT_TOO_LARGE_CODE } from '../project.error';
import {
  PROJECT_DEFAULT_MAX_AUTOSAVES,
  PROJECT_DEFAULT_MAX_CHECKPOINTS,
} from './project-field-limits';

export class ContentSizeBreakdownDto {
  @ApiProperty({ example: 2048, description: 'UTF-8 bytes of Lua source' })
  code!: number;

  @ApiProperty({ example: 512, description: 'Painted sprite-sheet pixels' })
  sprites!: number;

  @ApiProperty({ example: 4, description: 'Sprites with at least one flag set' })
  flags!: number;

  @ApiProperty({ example: 300, description: 'Map tiles set' })
  map!: number;

  @ApiProperty({
    example: 1024,
    description: 'UTF-8 bytes of instruments, patterns, songs, sfx and samples',
  })
  sound!: number;

  @ApiProperty({ example: 112, description: 'Bytes of the colour palette' })
  palette!: number;

  @ApiProperty({ example: 4000, description: 'Sum of every category' })
  total!: number;

  @ApiProperty({
    example: 1,
    description: 'Game document schema version (0 = legacy document)',
  })
  schemaVersion!: number;
}

export class ProjectLimitsDto {
  @ApiProperty({
    example: PROJECT_CONTENT_MAX_BYTES,
    description: 'Maximum logical content size (bytes) a game can be published at',
  })
  maxContentBytes!: number;

  @ApiProperty({
    example: PROJECT_BLOB_MAX_BYTES,
    description: 'Maximum size (bytes) of an uploaded project blob',
  })
  maxBlobBytes!: number;

  @ApiProperty({
    example: PROJECT_DEFAULT_MAX_CHECKPOINTS,
    description: 'Named versions a project may hold; saving under an existing name rewrites it',
  })
  maxCheckpoints!: number;

  @ApiProperty({
    example: PROJECT_DEFAULT_MAX_AUTOSAVES,
    description: 'Autosave slots kept per project, oldest pruned',
  })
  maxAutosaves!: number;
}

export class CheckpointLimitDto {
  @ApiProperty({ example: HttpStatus.BAD_REQUEST })
  statusCode!: number;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({ example: CHECKPOINT_LIMIT_CODE })
  code!: string;

  @ApiProperty({
    example: `${PROJECT_DEFAULT_MAX_CHECKPOINTS} versions out of ${PROJECT_DEFAULT_MAX_CHECKPOINTS} - delete one to save another`,
  })
  message!: string;

  @ApiProperty({
    example: PROJECT_DEFAULT_MAX_CHECKPOINTS,
    description: 'Named versions the project holds',
  })
  count!: number;

  @ApiProperty({
    example: PROJECT_DEFAULT_MAX_CHECKPOINTS,
    description: 'Named versions it may hold',
  })
  max!: number;
}

export class ProjectSizeDto {
  @ApiProperty({ example: 1, description: 'Project ID' })
  projectId!: number;

  @ApiProperty({ type: ContentSizeBreakdownDto })
  contentSize!: ContentSizeBreakdownDto;

  @ApiProperty({
    example: PROJECT_CONTENT_MAX_BYTES,
    description: 'Maximum logical content size (bytes) a game can be published at',
  })
  maxContentBytes!: number;

  @ApiProperty({
    example: true,
    description: 'Whether the project fits within the publishing budget',
  })
  withinBudget!: boolean;
}

export class ProjectTooLargeDto {
  @ApiProperty({ example: HttpStatus.PAYLOAD_TOO_LARGE })
  statusCode!: number;

  @ApiProperty({ example: 'Payload Too Large' })
  error!: string;

  @ApiProperty({ example: PROJECT_TOO_LARGE_CODE })
  code!: string;

  @ApiProperty({
    example: `Project content is 1200000 bytes, above the ${PROJECT_CONTENT_MAX_BYTES} bytes limit`,
  })
  message!: string;

  @ApiProperty({ type: ContentSizeBreakdownDto })
  contentSize!: ContentSizeBreakdownDto;

  @ApiProperty({ example: PROJECT_CONTENT_MAX_BYTES })
  maxContentBytes!: number;
}
