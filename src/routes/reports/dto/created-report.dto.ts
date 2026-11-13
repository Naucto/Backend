import { ApiProperty } from '@nestjs/swagger';

export class CreatedReportDto {
  @ApiProperty()
  id!: number;
}
