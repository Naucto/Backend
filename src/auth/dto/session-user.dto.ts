import { Permission } from "@auth/permissions";
import { ApiProperty } from "@nestjs/swagger";
import { AccountStatus } from "@prisma/client";

export class SessionUserDto {
  @ApiProperty({ example: 1 })
    id!: number;

  @ApiProperty({ example: "admin@naucto.com" })
    email!: string;

  @ApiProperty({ example: "admin" })
    username!: string;

  @ApiProperty({ required: false, nullable: true })
    nickname!: string | null;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
    accountStatus!: AccountStatus;

  @ApiProperty({ type: [String], example: ["Admin"] })
    roles!: string[];
  @ApiProperty({ enum: Permission, enumName: "Permission", isArray: true })
  permissions!: Permission[];
}
