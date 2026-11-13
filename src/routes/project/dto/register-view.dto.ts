import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class RegisterViewDto {
  @ApiPropertyOptional({
    description:
      'Ignored: views are counted by account or network address. Accepted so older pages are not refused',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  visitorId?: string;
}
