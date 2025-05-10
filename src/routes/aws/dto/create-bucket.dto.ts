import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateBucketDto {
  @ApiProperty({
    description: 'Optional bucket location constraint',
    required: false,
  })
  @IsOptional()
  @IsString()
  readonly locationConstraint?: string;
}