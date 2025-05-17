import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class UploadFileDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'File to upload',
  })
  file: any;

  @ApiProperty({
    description: 'Optional metadata for the file',
    required: false,
    type: 'string',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  readonly metadata?: Record<string, string>;
}
