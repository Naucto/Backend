import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsObject, IsOptional, ValidateIf, ValidateNested } from 'class-validator';

import {
  DISK_COLORS,
  DISK_FINISHES,
  DISK_GRAD_DIRS,
  DiskColor,
  DiskFinish,
  DiskGradDir,
} from './disk-style-limits';

/** The disk an author chose for their game. */
export class DiskStyleDto {
  @ApiProperty({
    enum: DISK_COLORS,
    enumName: 'DiskColor',
    description: 'A colour of the engine palette',
  })
  @IsIn(DISK_COLORS)
  color!: DiskColor;

  @ApiProperty({ enum: DISK_FINISHES, enumName: 'DiskFinish' })
  @IsIn(DISK_FINISHES)
  finish!: DiskFinish;

  @ApiPropertyOptional({
    enum: DISK_COLORS,
    enumName: 'DiskColor',
    description: 'The second colour, for a finish that takes two',
  })
  @IsOptional()
  @IsIn(DISK_COLORS)
  color2?: DiskColor;

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
