import { CreateUserDto } from './create-user.dto';
import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsArray } from 'class-validator';

export class CreateUserRoleDto extends CreateUserDto {
  @ApiProperty({ description: 'List of Role IDs to assign to the user', example: [2, 3] })
  @IsOptional()
  @IsArray()
  roles?: number[];
}
