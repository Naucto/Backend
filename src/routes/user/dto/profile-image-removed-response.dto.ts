import { ApiProperty } from '@nestjs/swagger';

export class ProfileImageRemovedResponseDto {
  @ApiProperty({ example: 'Profile picture removed successfully' })
  message!: string;

  @ApiProperty({
    description: 'User ID',
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
  })
  id!: string;
}
