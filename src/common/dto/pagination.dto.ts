import { ApiProperty } from "@nestjs/swagger";

export class PaginationDto {
  @ApiProperty({ required: false, default: 1 })
  page?: number = 1;

  @ApiProperty({ required: false, default: 10 })
  limit?: number = 10;
}
