import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";

export class JoinByCodeDto {
  @ApiProperty({ description: "Invite code of the session to join" })
  @IsString()
  @Length(1, 16)
  joinCode!: string;
}
