import { ApiProperty } from '@nestjs/swagger';

export class ProjectActionResponseDto {
  @ApiProperty({ example: 'Project published successfully' })
  message!: string;

  @ApiProperty({
    format: 'uuid',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    description: 'The project acted on',
  })
  id!: string;
}

export class VersionDeletedResponseDto {
  @ApiProperty({ example: 'Version deleted successfully' })
  message!: string;

  @ApiProperty({
    example: '1742901234567',
    description: 'Name of the deleted autosave',
  })
  name!: string;
}
