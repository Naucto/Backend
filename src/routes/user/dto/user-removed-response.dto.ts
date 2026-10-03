import { ApiProperty } from '@nestjs/swagger';

export class UserRemovedResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 200 })
  statusCode!: number;

  @ApiProperty({ description: 'Response message', example: 'User deleted successfully' })
  message!: string;
}
