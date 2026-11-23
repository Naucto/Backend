import { ApiProperty } from '@nestjs/swagger';

export class ProjectClipDto {
  @ApiProperty({
    description: 'Address of the clip just stored, usable as is',
    example:
      'https://cdn.example.com/projects/7c9e6679-7425-40de-944b-e07fc1f90ae7/clip?v=5d41402abc4b2a76b9719d911017c592',
  })
  clipUrl!: string;
}
