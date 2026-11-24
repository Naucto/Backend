import { HttpStatus } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

import { PROJECT_HIDDEN_CODE } from '../project.error';

/** What a route answers about a game moderation withholds. */
export class ProjectHiddenDto {
  @ApiProperty({ example: HttpStatus.FORBIDDEN })
  statusCode!: number;

  @ApiProperty({ example: 'Forbidden' })
  error!: string;

  @ApiProperty({ enum: [PROJECT_HIDDEN_CODE] })
  code!: typeof PROJECT_HIDDEN_CODE;

  @ApiProperty({ example: 'This game is unavailable' })
  message!: string;
}
