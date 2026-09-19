import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength
} from "class-validator";
import { ProjectExResponseDto } from "@project/dto/project-response.dto";

export const FEATURED_NOTE_MAX_LENGTH = 280;

export class SetFeaturedReleaseDto {
  @ApiProperty({ example: 42, description: "ID of the published project" })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
    projectId!: number;

  @ApiProperty({
    example: "Editor's pick: a tight one-button platformer",
    description: "Optional curator note shown next to the featured game",
    required: false,
    maxLength: FEATURED_NOTE_MAX_LENGTH
  })
  @IsOptional()
  @IsString()
  @MaxLength(FEATURED_NOTE_MAX_LENGTH)
    note?: string;
}

export class FeaturedCuratorDto {
  @ApiProperty({ example: 1 })
    id!: number;

  @ApiProperty({ example: "admin" })
    username!: string;
}

export class FeaturedReleaseDto {
  @ApiProperty({ example: 7, description: "Featured entry ID" })
    id!: number;

  @ApiProperty({ example: 42, description: "Featured project ID" })
    projectId!: number;

  @ApiProperty({ type: String, nullable: true, required: false })
    note!: string | null;

  @ApiProperty({ example: "2026-08-17T09:00:00Z" })
    startsAt!: Date;

  @ApiProperty({ type: String, nullable: true, required: false })
    endsAt!: Date | null;

  @ApiProperty({ type: FeaturedCuratorDto, nullable: true, required: false })
    featuredBy!: FeaturedCuratorDto | null;

  @ApiProperty({
    type: ProjectExResponseDto,
    description: "Release metadata of the featured project"
  })
    project!: ProjectExResponseDto;
}

export class FeaturedReleaseResponseDto {
  @ApiProperty({
    type: FeaturedReleaseDto,
    nullable: true,
    description: "The current featured release, or null when none is set"
  })
    featured!: FeaturedReleaseDto | null;
}

export class FeaturedProjectSummaryDto {
  @ApiProperty({ example: 42 })
    id!: number;

  @ApiProperty({ example: "Moon Lander" })
    name!: string;
}

export class FeaturedReleaseHistoryEntryDto {
  @ApiProperty({ example: 7 })
    id!: number;

  @ApiProperty({ example: 42 })
    projectId!: number;

  @ApiProperty({ type: String, nullable: true, required: false })
    note!: string | null;

  @ApiProperty({ example: "2026-08-10T09:00:00Z" })
    startsAt!: Date;

  @ApiProperty({ type: String, nullable: true, required: false })
    endsAt!: Date | null;

  @ApiProperty({ type: FeaturedCuratorDto, nullable: true, required: false })
    featuredBy!: FeaturedCuratorDto | null;

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
