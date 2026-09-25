import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { TokenScope } from "@auth/auth.types";

export class SessionQueryDto {
  @ApiPropertyOptional({ enum: ["user", "admin"], default: "user" })
  @IsOptional()
  @IsIn(["user", "admin"])
  scope?: TokenScope;
}
