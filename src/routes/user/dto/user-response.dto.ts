import { ApiProperty } from "@nestjs/swagger";
import { Expose, Type } from "class-transformer";

export class UserRoleDto {
  @ApiProperty({ description: "Role ID", example: 1 })
  @Expose()
    id!: number;

  @ApiProperty({ description: "Role name", example: "Admin" })
  @Expose()
    name!: string;
}

export class UserResponseDto {
  @ApiProperty({ description: "User ID", example: 1 })
  @Expose()
    id!: number;

  @ApiProperty({ description: "User email address", example: "user@example.com" })
  @Expose()
    email!: string;

  @ApiProperty({ description: "Username", example: "xX_DarkGamer_Xx" })
  @Expose()
    username!: string;

  @ApiProperty({ description: "User nickname", example: "JohnDoe", nullable: true })
  @Expose()
    nickname?: string;

  @ApiProperty({ description: "User description", example: "here is my description", nullable: true })
  @Expose()
    description?: string;

  @ApiProperty({ description: "Profile image URL", example: "https://cdn.example.com/users/1/profile.jpg", nullable: true })
  @Expose()
    profileImageUrl?: string;
  
  @ApiProperty({ description: "User roles", type: [UserRoleDto], required: false })
  @Expose()
  @Type(() => UserRoleDto)
    roles?: UserRoleDto[];

  @ApiProperty({ description: "User creation date", example: "2023-01-01T00:00:00.000Z" })
  @Expose()
    createdAt!: Date;

  @ApiProperty({ description: "User last update date", example: "2023-01-01T00:00:00.000Z" })
  @Expose()
    updatedAt!: Date;
}
