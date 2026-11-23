import { ApiProperty } from '@nestjs/swagger';

import { IsId } from '../../../common/decorators/is-id';

export class InviteToSessionDto {
  @ApiProperty({
    description: 'Who to invite',
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
  })
  @IsId()
  userId!: string;
}
