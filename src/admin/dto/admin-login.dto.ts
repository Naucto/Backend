import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class AdminLoginDto {
  @ApiProperty({ example: "admin@naucto.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: "********" })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
