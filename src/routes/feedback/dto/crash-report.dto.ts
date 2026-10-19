import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

import { APP_RELEASE_MAX_LENGTH, PATH_MAX_LENGTH, PATH_PATTERN } from './feedback.dto';

export const CRASH_NAME_MAX_LENGTH = 120;
export const CRASH_MESSAGE_MAX_LENGTH = 500;
export const CRASH_STACK_MAX_LENGTH = 8_000;

export const BROWSER_CRASH_SOURCES = ['web', 'engine'] as const;
export type BrowserCrashSource = (typeof BROWSER_CRASH_SOURCES)[number];

/** What the browser knows about the runtime a crash happened in. Nothing about the person. */
export class CrashExtraDto {
  @ApiPropertyOptional({ description: 'The engine fault kind, as `webgl-context-lost`' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  kind?: string;

  @ApiPropertyOptional({ description: 'The engine phase the fault happened in, as `draw`' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phase?: string;

  @ApiPropertyOptional({ description: 'The WebGL renderer string' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  renderer?: string;

  @ApiPropertyOptional({ description: 'The state of the audio context, as `suspended`' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  audio?: string;
}

/** An uncaught error of the web app or a fault of the engine, sent with no identifier. */
export class CrashReportDto {
  @ApiProperty({ enum: BROWSER_CRASH_SOURCES })
  @IsIn(BROWSER_CRASH_SOURCES)
  source!: BrowserCrashSource;

  @ApiProperty({ example: 'TypeError', maxLength: CRASH_NAME_MAX_LENGTH })
  @IsString()
  @MaxLength(CRASH_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({ maxLength: CRASH_MESSAGE_MAX_LENGTH })
  @IsString()
  @MaxLength(CRASH_MESSAGE_MAX_LENGTH)
  message!: string;

  @ApiProperty({ maxLength: CRASH_STACK_MAX_LENGTH })
  @IsString()
  @MaxLength(CRASH_STACK_MAX_LENGTH)
  stack!: string;

  @ApiProperty({ example: '/play/42' })
  @IsString()
  @MaxLength(PATH_MAX_LENGTH)
  @Matches(PATH_PATTERN)
  route!: string;

  @ApiPropertyOptional({ maxLength: APP_RELEASE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(APP_RELEASE_MAX_LENGTH)
  appRelease?: string;

  @ApiPropertyOptional({ type: CrashExtraDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CrashExtraDto)
  extra?: CrashExtraDto;
}
