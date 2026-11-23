import { ApiProperty } from '@nestjs/swagger';

import { IsId } from '../../../common/decorators/is-id';

export class KickWorkSessionDto {
  @ApiProperty({
    description: 'The ID of the user participating in the work session',
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
  })
  @IsId()
  userId!: string;
}
