import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FlagStatus, ModerationReason, ModerationTargetType } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  ModerationAccountRefDto,
  ModerationActionDto,
  TargetContentDto,
} from './moderation-action.dto';

export const CASE_VIEWS = ['OPEN', 'RESOLVED', 'ALL'] as const;
export type CaseView = (typeof CASE_VIEWS)[number];

export const CASE_SORTS = ['lastFlagged', 'flags'] as const;
export type CaseSort = (typeof CASE_SORTS)[number];

export const CASE_STATUSES = ['OPEN', 'RESOLVED'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/**
 * Where a target stands. VISIBLE: others can reach it. UNPUBLISHED: it exists and its owner keeps
 * it to themselves. HIDDEN: moderation withholds it. SUSPENDED: an account under a suspension.
 * DELETED: removed by a user, its row kept. GONE: no row is left.
 */
export const TARGET_STATES = [
  'VISIBLE',
  'UNPUBLISHED',
  'HIDDEN',
  'SUSPENDED',
  'DELETED',
  'GONE',
] as const;
export type TargetState = (typeof TARGET_STATES)[number];

/**
 * What staff can do from a moderation screen. HIDE, RESTORE and DELETE bear on content. The others
 * bear on the account: the target itself, or the owner of the content.
 */
export const MODERATION_OPERATIONS = [
  'DISMISS',
  'HIDE',
  'RESTORE',
  'DELETE',
  'WARN',
  'SUSPEND',
  'REINSTATE',
  'CLEAR_PROFILE',
  'DELETE_ACCOUNT',
] as const;
export type ModerationOperation = (typeof MODERATION_OPERATIONS)[number];

/** Who the owner of a target lets read it, for a target whose owner chooses. */
export const TARGET_VISIBILITIES = ['PUBLIC', 'UNLISTED', 'PRIVATE'] as const;
export type TargetVisibility = (typeof TARGET_VISIBILITIES)[number];

/** What a case is about, with where to look at it on the web app. */
export class CaseTargetDto {
  @ApiProperty({ enum: ModerationTargetType, enumName: 'ModerationTargetType' })
  type!: ModerationTargetType;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TARGET_STATES, enumName: 'ModerationTargetState' })
  state!: TargetState;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'What to call the target: its title or its name, else the start of its text',
  })
  label!: string | null;

  @ApiPropertyOptional({
    type: ModerationAccountRefDto,
    nullable: true,
    description: 'The account itself, or the account the content belongs to',
  })
  owner!: ModerationAccountRefDto | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The game itself, or the game the target sits on. Null for any other target',
  })
  projectId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  projectName!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The play page of the game, null while players cannot reach it',
  })
  playUrl!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The staff preview of the game in the player, null for an account',
  })
  previewPlayUrl!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The staff preview of the game in the editor, null for an account',
  })
  previewEditUrl!: string | null;
}

/** A game a target lists. */
export class CaseListedGameDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'The name the hub shows, else the one of the draft' })
  name!: string;
}

/** Every flag on one target, as the queue lists them. */
export class CaseSummaryDto {
  @ApiProperty({ type: CaseTargetDto })
  target!: CaseTargetDto;

  @ApiProperty({ enum: CASE_STATUSES, enumName: 'ModerationCaseStatus' })
  status!: CaseStatus;

  @ApiProperty()
  openFlags!: number;

  @ApiProperty()
  totalFlags!: number;

  @ApiProperty({
    enum: ModerationReason,
    enumName: 'ModerationReason',
    isArray: true,
    description: 'The reasons of the open flags, or of every flag once the case is resolved',
  })
  reasons!: ModerationReason[];

  @ApiProperty()
  firstFlaggedAt!: Date;

  @ApiProperty()
  lastFlaggedAt!: Date;
}

export class CaseListDto {
  @ApiProperty({ type: [CaseSummaryDto] })
  items!: CaseSummaryDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class CaseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CASE_VIEWS, default: 'OPEN' })
  @IsOptional()
  @IsIn(CASE_VIEWS)
  view?: CaseView;

  @ApiPropertyOptional({ enum: ModerationTargetType, enumName: 'ModerationTargetType' })
  @IsOptional()
  @IsEnum(ModerationTargetType)
  targetType?: ModerationTargetType;

  @ApiPropertyOptional({ enum: ModerationReason, enumName: 'ModerationReason' })
  @IsOptional()
  @IsEnum(ModerationReason)
  reason?: ModerationReason;

  @ApiPropertyOptional({
    enum: CASE_SORTS,
    default: 'lastFlagged',
    description: 'Flagged last first, or flagged most first',
  })
  @IsOptional()
  @IsIn(CASE_SORTS)
  sort?: CaseSort;
}

export class CaseFlagDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: ModerationAccountRefDto })
  reporter!: ModerationAccountRefDto;

  @ApiProperty({ enum: ModerationReason, enumName: 'ModerationReason' })
  reason!: ModerationReason;

  @ApiPropertyOptional({ type: String, nullable: true })
  details!: string | null;

  @ApiProperty({ type: TargetContentDto, description: 'The target as it read when flagged' })
  snapshot!: TargetContentDto;

  @ApiProperty({ enum: FlagStatus, enumName: 'FlagStatus' })
  status!: FlagStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ type: Date, nullable: true })
  resolvedAt!: Date | null;

  @ApiPropertyOptional({ type: ModerationAccountRefDto, nullable: true })
  resolvedBy!: ModerationAccountRefDto | null;
}

export class CaseDetailDto extends CaseSummaryDto {
  @ApiPropertyOptional({
    type: TargetContentDto,
    nullable: true,
    description: 'The target as it reads now, null once it is gone',
  })
  current!: TargetContentDto | null;

  @ApiPropertyOptional({
    enum: TARGET_VISIBILITIES,
    enumName: 'ModerationTargetVisibility',
    nullable: true,
    description:
      'Who its owner lets read the target: anyone, whoever holds its id, or the owner alone. Null for a target whose owner has no such choice',
  })
  visibility!: TargetVisibility | null;

  @ApiProperty({
    type: [CaseListedGameDto],
    description:
      'The games the target lists, in its order, on the hub or not. Empty for a target that lists none',
  })
  games!: CaseListedGameDto[];

  @ApiProperty({ type: [CaseFlagDto], description: 'Newest first' })
  flags!: CaseFlagDto[];

  @ApiProperty({ type: [ModerationActionDto], description: 'What was done to the target' })
  history!: ModerationActionDto[];

  @ApiProperty({
    type: [ModerationActionDto],
    description: 'The latest actions that bore on the owner, on any of their content',
  })
  ownerHistory!: ModerationActionDto[];

  @ApiProperty({
    enum: MODERATION_OPERATIONS,
    enumName: 'ModerationOperation',
    isArray: true,
    description: 'What the caller may do now, given their role and the state of the target',
  })
  allowedActions!: ModerationOperation[];
}

/** What the sidebar of the admin console counts. */
export class OpenCaseCountDto {
  @ApiProperty({ description: 'Targets holding at least one open flag' })
  openCases!: number;

  @ApiProperty()
  openFlags!: number;
}
