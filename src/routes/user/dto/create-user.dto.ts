import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsArray, Length, IsUrl } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateUserDto {
  @ApiProperty({
    description: "User email address",
    example: "user@example.com",
  })
  @IsEmail()
  @IsNotEmpty()
    email!: string;

  @ApiProperty({ description: "User username", example: "xX_DarkGamer_Xx" })
  @IsString()
  @Length(3, 20, { message: "Username must be between 3 and 20 characters" })
    username!: string;

  @ApiProperty({ description: "User nick name", example: "JohnDoe", required: false })
  @IsString()
  @IsOptional()
  @Length(3, 30, { message: "Nickname must be between 3 and 30 characters" })
    nickname?: string;

  @ApiProperty({ description: "User password", example: "password123" })
  @IsString()
  @MinLength(6, { message: "Password must be at least 6 characters" })
  @IsNotEmpty()
    password!: string;
  
  @ApiProperty({ description: "Description of the user", example: "I love coding", required: false })
  @IsString()
  @IsOptional()
  @Length(0, 200, { message: "Description must be less than 200 characters" })
    description?: string;

  @ApiProperty({ description: "Profile image URL", example: "https://cdn.example.com/users/1/profile.jpg", required: false })
  @IsOptional()
  @IsUrl()
    profileImageUrl?: string;
  
  @IsOptional()
  @IsArray()
    roles?: string[];
}
