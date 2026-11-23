import { ApiProperty } from '@nestjs/swagger';

export class LegacyProjectDto {
  @ApiProperty({
    format: 'uuid',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    description: 'The id of the project the number named',
  })
  id!: string;
}
