import { ApiProperty } from '@nestjs/swagger';

export class ImageUrlResponseDto {
  @ApiProperty({
    example: 'https://cdn.example.com/projects/7c9e6679-7425-40de-944b-e07fc1f90ae7/image',
    description: 'The public CDN URL for the image',
  })
  url!: string;
}
