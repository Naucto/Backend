import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from './user.dto';

export class AuthResponseDto {
  @ApiProperty({ example: 'jwt_token_here' })
  access_token: string;

  @ApiProperty({ type: UserDto })
  user: UserDto;
}
