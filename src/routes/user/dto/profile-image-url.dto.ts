import { ApiProperty } from '@nestjs/swagger';

export class ProfileImageUrlDto {
  @ApiProperty({
    description: 'Public CDN URL of the image, versioned so a replacement is not served from cache',
    example: 'https://cdn.example/users/12/profile?v=abc',
  })
  resourceUrl!: string;
}
