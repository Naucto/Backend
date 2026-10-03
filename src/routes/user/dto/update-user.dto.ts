import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { ROLE_NAMES, USER } from '../../../auth/access/roles';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiProperty({
    description: 'Role the user holds, replacing the one they held',
    enum: ROLE_NAMES,
    example: USER,
    required: false,
  })
  @IsOptional()
  @IsIn(ROLE_NAMES)
  role?: string;
}
