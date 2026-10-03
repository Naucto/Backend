import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class InviteToSessionDto {
  @ApiProperty({ description: 'Who to invite', example: 42 })
  @IsInt()
  @Min(1)
  userId!: number;
}
