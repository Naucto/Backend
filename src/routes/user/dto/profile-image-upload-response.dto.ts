import { ApiProperty } from '@nestjs/swagger';

export class ProfileImageUploadResponseDto {
  @ApiProperty({ example: 'Profile picture uploaded successfully' })
  message!: string;

  @ApiProperty({
    description: 'User ID',
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
  })
  id!: string;

  @ApiProperty({
    description: 'Where the image now lives, versioned so a replacement is not served from cache',
    example: 'https://cdn.example/users/3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b/profile?v=abc',
  })
  resourceUrl!: string;
}
