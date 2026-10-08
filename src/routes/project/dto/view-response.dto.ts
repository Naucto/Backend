import { ApiProperty } from '@nestjs/swagger';

export class ViewResponseDto {
  @ApiProperty({
    example: 128,
    description: 'The number of plays counted for the project',
  })
  viewCount!: number;
}
