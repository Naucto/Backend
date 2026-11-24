import { ApiProperty } from '@nestjs/swagger';

export class PublicUserSearchHitDto {
  @ApiProperty({
    description: 'User ID',
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
  })
  id!: string;

  @ApiProperty({ description: 'Handle, unique across the platform', example: 'louis' })
  username!: string;

  @ApiProperty({
    description: 'Display name',
    example: 'Louis',
    type: String,
    nullable: true,
    required: false,
  })
  nickname!: string | null;

  @ApiProperty({
    description: 'Profile picture, null when the person has not set one',
    example: 'https://cdn.example/users/3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b/profile?v=abc',
    type: String,
    nullable: true,
    required: false,
  })
  profileImageUrl!: string | null;
}

export class PublicUserSearchResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 200 })
  statusCode!: number;

  @ApiProperty({ description: 'Response message', example: 'Users retrieved successfully' })
  message!: string;

  @ApiProperty({ description: 'Matching people', type: [PublicUserSearchHitDto] })
  data!: PublicUserSearchHitDto[];
}
