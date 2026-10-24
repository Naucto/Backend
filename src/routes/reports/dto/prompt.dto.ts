import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const PROMPT_ACTIONS = ['snooze', 'decline', 'reset'] as const;
export type PromptAction = (typeof PROMPT_ACTIONS)[number];

export class FeedbackPromptDto {
  @ApiProperty({ description: 'Whether the rating prompt may ask this account now' })
  eligible!: boolean;

  @ApiProperty({ description: 'Whether this account asked never to be asked again' })
  declined!: boolean;
}

export class UpdateFeedbackPromptDto {
  @ApiProperty({
    enum: PROMPT_ACTIONS,
    description:
      '`snooze` asks again in 14 days, `decline` never asks again, `reset` lets the prompt ask again',
  })
  @IsIn(PROMPT_ACTIONS)
  action!: PromptAction;
}
