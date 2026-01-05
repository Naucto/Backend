import { ApiProperty } from "@nestjs/swagger";
import { RoleDto } from "./role.dto";

export class UserDto {
    @ApiProperty({ example: 1, description: "User ID" })
      id!: number;

    @ApiProperty({ example: "user@example.com", description: "User email" })
      email!: string;

    @ApiProperty({ example: "user_name", description: "Username" })
      username!: string;

    @ApiProperty({ example: "First", required: false, description: "Optional nickname" })
      nickname?: string | null;

    @ApiProperty({ example: "2025-05-05T12:51:04.098Z", description: "Date of creation" })
      createdAt!: Date;

    @ApiProperty({ type: [RoleDto], required: false, description: "List of user roles" })
      roles?: RoleDto[];
}
