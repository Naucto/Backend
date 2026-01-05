// dto/role.dto.ts
import { ApiProperty } from "@nestjs/swagger";

export class RoleDto {
    @ApiProperty({ example: 2, description: "Role ID" })
      id!: number;

    @ApiProperty({ example: "admin", description: "Role name" })
      name!: string;
}
