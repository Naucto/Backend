import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A suspension an account is under now. */
export class SuspensionDto {
  @ApiProperty()
  since!: Date;

  @ApiPropertyOptional({
    type: Date,
    nullable: true,
    description: 'When it ends by itself, null when only staff can lift it',
  })
  until!: Date | null;
}
