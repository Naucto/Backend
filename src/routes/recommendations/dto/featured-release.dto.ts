import { ApiProperty } from '@nestjs/swagger';

import { ProjectExResponseDto } from '../../project/dto/project-response.dto';

export class FeaturedCuratorDto {
  @ApiProperty({ format: 'uuid', example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'admin' })
  username!: string;
}

export class FeaturedEntryDto {
  @ApiProperty({
    format: 'uuid',
    example: '5a1c3e7b-2d4f-4a6b-9c8d-0e1f2a3b4c5d',
    description: 'Featured entry ID',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    description: 'Featured project ID',
  })
  projectId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    required: false,
    description: 'What a curator wrote about the pick; null for a pick the hub made itself',
  })
  note!: string | null;

  @ApiProperty({ example: '2026-08-17T09:00:00Z' })
  startsAt!: Date;

  @ApiProperty({ type: String, nullable: true, required: false })
  endsAt!: Date | null;

  @ApiProperty({
    type: FeaturedCuratorDto,
    nullable: true,
    required: false,
    description: 'The curator of a pick made by hand; null for a pick the hub made itself',
  })
  featuredBy!: FeaturedCuratorDto | null;
}

export class FeaturedReleaseDto extends FeaturedEntryDto {
  @ApiProperty({
    type: ProjectExResponseDto,
    description: 'Release metadata of the featured project',
  })
  project!: ProjectExResponseDto;
}

export class FeaturedReleaseResponseDto {
  @ApiProperty({
    type: FeaturedReleaseDto,
    nullable: true,
    description: 'The current featured release, or null when none is set',
  })
  featured!: FeaturedReleaseDto | null;
}

export class FeaturedProjectSummaryDto {
  @ApiProperty({ format: 'uuid', example: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })
  id!: string;

  @ApiProperty({ example: 'Moon Lander' })
  name!: string;
}

export class FeaturedReleaseHistoryEntryDto extends FeaturedEntryDto {
  @ApiProperty({ type: FeaturedProjectSummaryDto })
  project!: FeaturedProjectSummaryDto;
}

export class FeaturedReleaseHistoryDto {
  @ApiProperty({ type: [FeaturedReleaseHistoryEntryDto] })
  items!: FeaturedReleaseHistoryEntryDto[];

  @ApiProperty({ example: 12 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}
