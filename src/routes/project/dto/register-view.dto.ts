import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class RegisterViewDto {
  @ApiPropertyOptional({
    description:
      'The visitor cookie of a browser that consented to analytics; without it the play counts but no viewer is kept',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  visitorId?: string;
}
