import { ApiProperty } from '@nestjs/swagger';

import { SuspensionDto } from './suspension.dto';
import { UserResponseDto } from './user-response.dto';

export class UserProfileResponseDto extends UserResponseDto {
  @ApiProperty({
    description: 'Public CDN URL of the profile image (if any)',
    type: String,
    example: 'https://cdn.example.com/users/3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b/profile?v=abc123',
    nullable: true,
  })
  profileImageUrl?: string | null;

  @ApiProperty({
    description: 'Public CDN URL of the profile background image (if any)',
    type: String,
    example:
      'https://cdn.example.com/users/3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b/background?v=abc123',
    nullable: true,
  })
  backgroundImageUrl?: string | null;

  @ApiProperty({
    description:
      'The suspension the account is under, null in good standing. Its reason is in the standing.',
    type: SuspensionDto,
    nullable: true,
  })
  suspension!: SuspensionDto | null;
}
