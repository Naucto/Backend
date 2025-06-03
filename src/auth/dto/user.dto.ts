import { ApiProperty } from '@nestjs/swagger';
import { RoleDto } from './role.dto';

export class UserDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiProperty({ example: 'user_name' })
  username!: string;

  @ApiProperty({ example: 'First', required: false })
  nickname?: string | null;

  @ApiProperty({ example: '2025-05-05T12:51:04.098Z' })
  createdAt!: Date;

  @ApiProperty({ type: [RoleDto], required: false })
  roles?: RoleDto[];
}
