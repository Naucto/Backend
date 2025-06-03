// dto/role.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class RoleDto {
  @ApiProperty({ example: 2 })
  id!: number;

  @ApiProperty({ example: 'admin' })
  name!: string;
}
