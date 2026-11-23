import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationActionType, ModerationReason, ModerationTargetType } from '@prisma/client';
import { IsEnum, IsOptional, Matches } from 'class-validator';

import { ROLE_NAMES, RoleName } from '../../../auth/access/roles';
import { IsId } from '../../../common/decorators/is-id';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { DAY_PATTERN } from '../../analytics/dto/admin-analytics-query.dto';

/** An account as a moderation screen names it. */
export class ModerationAccountRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  nickname!: string | null;

  @ApiProperty({ enum: ROLE_NAMES })
  role!: RoleName;

  @ApiProperty({ description: 'Whether the account was erased since' })
  deleted!: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The public profile on the web app, null once the account is erased',
  })
  profileUrl!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Null unless the caller is an admin: moderators do not read addresses',
  })
  email!: string | null;
}

/** The text of a game, a comment or a profile at one moment. */
export class TargetContentDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The name of a game or the display name of an account. A comment has none.',
  })
  title!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The descriptions of a game, the text of a comment or the bio of an account',
  })
  body!: string | null;
}

/** One row of the moderation log, as staff read it. */
export class ModerationActionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ModerationActionType, enumName: 'ModerationActionType' })
  action!: ModerationActionType;

  @ApiProperty({ type: ModerationAccountRefDto })
  actor!: ModerationAccountRefDto;

  @ApiProperty({ enum: ModerationTargetType, enumName: 'ModerationTargetType' })
  targetType!: ModerationTargetType;

  @ApiProperty({ format: 'uuid' })
  targetId!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'What the target was called when the action was taken',
  })
  targetLabel!: string | null;

  @ApiPropertyOptional({
    type: ModerationAccountRefDto,
    nullable: true,
    description: 'The account the action bore on: the one warned, or the owner of the content',
  })
  subject!: ModerationAccountRefDto | null;

  @ApiPropertyOptional({ enum: ModerationReason, enumName: 'ModerationReason', nullable: true })
  reason!: ModerationReason | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'What the subject was told' })
  publicMessage!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  internalNote!: string | null;

  @ApiPropertyOptional({
    type: TargetContentDto,
    nullable: true,
    description: 'The content the action bore on, as it read then',
  })
  snapshot!: TargetContentDto | null;

  @ApiPropertyOptional({ type: Date, nullable: true, description: 'When a suspension ends' })
  expiresAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class ModerationLogDto {
  @ApiProperty({ type: [ModerationActionDto] })
  items!: ModerationActionDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class LogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ModerationActionType, enumName: 'ModerationActionType' })
  @IsOptional()
  @IsEnum(ModerationActionType)
  action?: ModerationActionType;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only the actions of this staff member' })
  @IsOptional()
  @IsId()
  actorId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only the actions that bore on this account',
  })
  @IsOptional()
  @IsId()
  subjectUserId?: string;

  @ApiPropertyOptional({ enum: ModerationTargetType, enumName: 'ModerationTargetType' })
  @IsOptional()
  @IsEnum(ModerationTargetType)
  targetType?: ModerationTargetType;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'With targetType, the history of one target',
  })
  @IsOptional()
  @IsId()
  targetId?: string;

  @ApiPropertyOptional({ description: 'First day, UTC, as YYYY-MM-DD' })
  @IsOptional()
  @Matches(DAY_PATTERN)
  from?: string;

  @ApiPropertyOptional({ description: 'Last day, UTC, as YYYY-MM-DD, included' })
  @IsOptional()
  @Matches(DAY_PATTERN)
  to?: string;
}
