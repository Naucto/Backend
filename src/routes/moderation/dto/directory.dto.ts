import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { ROLE_NAMES, RoleName } from '../../../auth/access/roles';
import { IsId } from '../../../common/decorators/is-id';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { trimmed } from '../../reports/dto/report-transforms';
import { SuspensionDto } from '../../user/dto/suspension.dto';
import { MODERATION_OPERATIONS, ModerationOperation } from './case.dto';
import { ModerationAccountRefDto } from './moderation-action.dto';

export const SEARCH_MAX_LENGTH = 100;

export const ACCOUNT_STANDINGS = ['GOOD', 'WARNED', 'SUSPENDED'] as const;
export type AccountStanding = (typeof ACCOUNT_STANDINGS)[number];

export const PROJECT_STATES = ['PUBLISHED', 'UNPUBLISHED', 'HIDDEN'] as const;
export type ProjectModerationState = (typeof PROJECT_STATES)[number];

export const COMMENT_STATES = ['VISIBLE', 'HIDDEN', 'DELETED'] as const;
export type CommentModerationState = (typeof COMMENT_STATES)[number];

class DirectoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Part of a name or of a text', maxLength: SEARCH_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  search?: string;
}

/** An account with where it stands, as the directory lists it. */
export class ModerationAccountDto extends ModerationAccountRefDto {
  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ enum: ACCOUNT_STANDINGS, enumName: 'AccountStanding' })
  standing!: AccountStanding;

  @ApiPropertyOptional({ type: SuspensionDto, nullable: true })
  suspension!: SuspensionDto | null;

  @ApiProperty()
  warnings!: number;

  @ApiProperty({ description: 'Games the account created, published or not' })
  games!: number;

  @ApiProperty()
  comments!: number;

  @ApiProperty({ description: 'Open flags on the account or on its content' })
  openFlags!: number;

  @ApiProperty({ description: 'Flags the account filed' })
  flagsFiled!: number;
}

export class ModerationAccountDetailDto extends ModerationAccountDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: MODERATION_OPERATIONS, enumName: 'ModerationOperation', isArray: true })
  allowedActions!: ModerationOperation[];
}

export class ModerationAccountListDto {
  @ApiProperty({ type: [ModerationAccountDto] })
  items!: ModerationAccountDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class AccountDirectoryQueryDto extends DirectoryQueryDto {
  @ApiPropertyOptional({ enum: ACCOUNT_STANDINGS, enumName: 'AccountStanding' })
  @IsOptional()
  @IsIn(ACCOUNT_STANDINGS)
  standing?: AccountStanding;

  @ApiPropertyOptional({ enum: ROLE_NAMES })
  @IsOptional()
  @IsIn(ROLE_NAMES)
  role?: RoleName;
}

/** A game with where it stands, published or not. */
export class ModerationProjectDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  shortDesc!: string;

  @ApiProperty({ type: ModerationAccountRefDto })
  owner!: ModerationAccountRefDto;

  @ApiProperty({ enum: PROJECT_STATES, enumName: 'ProjectModerationState' })
  state!: ProjectModerationState;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({ type: Date, nullable: true })
  publishedAt!: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  hiddenAt!: Date | null;

  @ApiProperty()
  openFlags!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The play page, null while players cannot reach the game',
  })
  playUrl!: string | null;

  @ApiProperty({ description: 'The staff preview in the player of the web app' })
  previewPlayUrl!: string;

  @ApiProperty({ description: 'The staff preview in the editor of the web app' })
  previewEditUrl!: string;
}

export class ModerationProjectDetailDto extends ModerationProjectDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  longDesc!: string | null;

  @ApiProperty({ type: [String] })
  tags!: string[];

  @ApiProperty({ type: [ModerationAccountRefDto] })
  collaborators!: ModerationAccountRefDto[];

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  forkedFromId!: string | null;

  @ApiProperty({ description: 'Whether the cover route has an image to serve' })
  hasCover!: boolean;

  @ApiProperty({ enum: MODERATION_OPERATIONS, enumName: 'ModerationOperation', isArray: true })
  allowedActions!: ModerationOperation[];
}

export class ModerationProjectListDto {
  @ApiProperty({ type: [ModerationProjectDto] })
  items!: ModerationProjectDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class ProjectDirectoryQueryDto extends DirectoryQueryDto {
  @ApiPropertyOptional({ enum: PROJECT_STATES, enumName: 'ProjectModerationState' })
  @IsOptional()
  @IsIn(PROJECT_STATES)
  state?: ProjectModerationState;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only the games this account created' })
  @IsOptional()
  @IsId()
  creatorId?: string;
}

/** A comment as staff read it: its text stays readable while it is hidden from everyone else. */
export class ModerationCommentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Empty once a user deleted the comment' })
  content!: string;

  @ApiProperty({ type: ModerationAccountRefDto })
  author!: ModerationAccountRefDto;

  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty()
  projectName!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The comment it replies to',
  })
  parentId!: string | null;

  @ApiProperty({ enum: COMMENT_STATES, enumName: 'CommentModerationState' })
  state!: CommentModerationState;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ type: Date, nullable: true })
  hiddenAt!: Date | null;

  @ApiProperty()
  openFlags!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The play page the comment is on, null while players cannot reach the game',
  })
  playUrl!: string | null;

  @ApiProperty({ enum: MODERATION_OPERATIONS, enumName: 'ModerationOperation', isArray: true })
  allowedActions!: ModerationOperation[];
}

export class ModerationCommentListDto {
  @ApiProperty({ type: [ModerationCommentDto] })
  items!: ModerationCommentDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class CommentDirectoryQueryDto extends DirectoryQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only the comments on this game' })
  @IsOptional()
  @IsId()
  projectId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only the comments of this account' })
  @IsOptional()
  @IsId()
  authorId?: string;

  @ApiPropertyOptional({ enum: COMMENT_STATES, enumName: 'CommentModerationState' })
  @IsOptional()
  @IsIn(COMMENT_STATES)
  state?: CommentModerationState;
}
