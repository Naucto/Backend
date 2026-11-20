import { ApiProperty } from '@nestjs/swagger';

import { ProjectExResponseDto } from '../../project/dto/project-response.dto';

export class FeaturedCuratorDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'admin' })
  username!: string;
}

export class FeaturedEntryDto {
  @ApiProperty({ example: 7, description: 'Featured entry ID' })
  id!: number;

  @ApiProperty({ example: 42, description: 'Featured project ID' })
  projectId!: number;

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
  @ApiProperty({ example: 42 })
  id!: number;

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
