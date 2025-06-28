import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

export class UserSingleResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 200 })
  statusCode!: number;

  @ApiProperty({ description: 'Response message', example: 'User retrieved successfully' })
  message!: string;

  @ApiProperty({ description: 'User data', type: UserResponseDto })
  data!: UserResponseDto;
}