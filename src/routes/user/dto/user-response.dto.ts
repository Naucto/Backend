import { ApiProperty } from "@nestjs/swagger";

export class UserRoleDto {
  @ApiProperty({ description: "Role ID", example: 1 })
    id!: number;

  @ApiProperty({ description: "Role name", example: "Admin" })
    name!: string;
}

export class UserResponseDto {
  @ApiProperty({ description: "User ID", example: 1 })
    id!: number;

  @ApiProperty({
    description: "User email address",
    example: "user@example.com"
  })
    email!: string;

  @ApiProperty({ description: "Username", example: "xX_DarkGamer_Xx" })
    username!: string;

  @ApiProperty({
    description: "User nickname",
    example: "JohnDoe",
    type: String,
    nullable: true
  })
    nickname!: string | null;

  @ApiProperty({
    description: "User roles",
    type: [UserRoleDto],
    required: false
  })
    roles?: UserRoleDto[];

  @ApiProperty({
    description: "User creation date",
    example: "2023-01-01T00:00:00.000Z"
  })
    createdAt!: Date;
}
