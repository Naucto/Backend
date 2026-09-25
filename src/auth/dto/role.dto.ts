import { Permission } from "@auth/permissions";
import { ApiProperty } from "@nestjs/swagger";

export class RoleDto {
  @ApiProperty({ example: 2, description: "Role ID" })
  id!: number;

  @ApiProperty({ example: "admin", description: "Role name" })
  name!: string;
  @ApiProperty({ enum: Permission, enumName: "Permission", isArray: true })
  permissions!: string[];
}
