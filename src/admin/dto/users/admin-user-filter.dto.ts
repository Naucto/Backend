import { ApiPropertyOptional } from "@nestjs/swagger";
import { AccountStatus } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString } from "class-validator";
import { AdminPaginationDto } from "../admin-pagination.dto";

export class AdminUserFilterDto extends AdminPaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() username?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nickname?: string;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  accountStatus?: AccountStatus;

  @ApiPropertyOptional({ description: "Filter users having this role name" })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({
    enum: ["id", "email", "username", "nickname", "createdAt", "accountStatus"]
  })
  @IsOptional()
  @IsIn(["id", "email", "username", "nickname", "createdAt", "accountStatus"])
  override sortBy?: string;
}
