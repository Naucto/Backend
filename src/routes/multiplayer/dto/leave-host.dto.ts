import { ApiProperty } from "@nestjs/swagger";

export class LeaveHostRequestDto {
  @ApiProperty()
    sessionUuid!: string;
};
