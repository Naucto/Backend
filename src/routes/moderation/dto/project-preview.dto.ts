import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { ProjectExResponseDto } from '../../project/dto/project-response.dto';

export const PREVIEW_SOURCES = ['draft', 'release'] as const;
export type PreviewSource = (typeof PREVIEW_SOURCES)[number];

/** A game as its collaborators read it, for staff who are not among them. */
export class ProjectPreviewDto extends ProjectExResponseDto {
  @ApiProperty({ description: 'Whether a released build exists, on the hub or withheld' })
  hasRelease!: boolean;
}

export class PreviewContentQueryDto {
  @ApiPropertyOptional({
    enum: PREVIEW_SOURCES,
    default: 'draft',
    description: 'The latest save, or the released build as players got it',
  })
  @IsOptional()
  @IsIn(PREVIEW_SOURCES)
  source?: PreviewSource;
}
