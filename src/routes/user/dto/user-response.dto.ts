import { ApiProperty } from '@nestjs/swagger';

import { ROLE_NAMES, USER } from '../../../auth/access/roles';

export class UserResponseDto {
  @ApiProperty({ description: 'User ID', example: 1 })
  id!: number;

  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  email!: string;

  @ApiProperty({ description: 'Username', example: 'xX_DarkGamer_Xx' })
  username!: string;

  @ApiProperty({
    description: 'User nickname',
    example: 'JohnDoe',
    type: String,
    nullable: true,
  })
  nickname!: string | null;

  @ApiProperty({ description: 'Role the user holds', enum: ROLE_NAMES, example: USER })
  role!: string;

  @ApiProperty({
    description: 'User creation date',
    example: '2023-01-01T00:00:00.000Z',
  })
  createdAt!: Date;
}
