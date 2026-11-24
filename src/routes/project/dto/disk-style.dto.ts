import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsObject, IsOptional, Matches, ValidateIf, ValidateNested } from 'class-validator';

import { DISK_FINISHES, DISK_GRAD_DIRS, DiskFinish, DiskGradDir } from './disk-style-limits';
import { HEX_COLOR } from './project-field-limits';

/** The disk an author chose for their game. */
export class DiskStyleDto {
  @ApiProperty({
    description: 'Any colour, as `#rrggbb`; answered in lower case',
    example: '#ff8426',
    pattern: HEX_COLOR.source,
  })
  @Matches(HEX_COLOR)
  color!: string;

  @ApiProperty({ enum: DISK_FINISHES, enumName: 'DiskFinish' })
  @IsIn(DISK_FINISHES)
  finish!: DiskFinish;

  @ApiPropertyOptional({
    description: 'The second colour, for a finish that takes two, as `#rrggbb`',
    example: '#ffd100',
    pattern: HEX_COLOR.source,
  })
  @IsOptional()
  @Matches(HEX_COLOR)
  color2?: string;

  @ApiPropertyOptional({
    enum: DISK_GRAD_DIRS,
    enumName: 'DiskGradDir',
    description: 'The direction of a gradient',
  })
  @IsOptional()
  @IsIn(DISK_GRAD_DIRS)
  gradDir?: DiskGradDir;
}

/** The disk of a project, as the route that sets it takes it and answers it. */
export class ProjectDiskDto {
  @ApiProperty({
    type: DiskStyleDto,
    nullable: true,
    description: 'Null for no chosen style: a client then derives a colour from the project id',
  })
  // Null is an answer, a missing field is not.
  @ValidateIf((dto: ProjectDiskDto) => dto.disk !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => DiskStyleDto)
  disk!: DiskStyleDto | null;
}
