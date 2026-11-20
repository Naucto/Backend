import { ApiProperty } from '@nestjs/swagger';

import { ProjectExResponseDto } from './project-response.dto';

/** A game as a card of the hub shows it. */
export class HubGameDto extends ProjectExResponseDto {
  @ApiProperty({
    description:
      'Address of the cover, usable as is: it changes when the cover does. Null without a cover',
    example: 'https://cdn.example.com/projects/1/image?v=5d41402abc4b2a76b9719d911017c592',
    type: String,
    nullable: true,
    required: true,
  })
  override coverUrl!: string | null;
}
