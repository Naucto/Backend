import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({
    description: "User email address",
    example: "user@example.com"
  })
  @IsEmail({}, { message: "Email must be a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email!: string;

  @ApiProperty({
    description: "User password",
    example: "password123",
    minLength: 6
  })
  @IsString()
  @MinLength(6, { message: "Password must be at least 6 characters" })
  @IsNotEmpty({ message: "Password is required" })
  password!: string;
}

export class GoogleLoginDto {
  @ApiProperty({
    description: "Google ID token",
    example: "eyJhbGciOiJSUzI1NiIs..."
  })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class GoogleCodeDto {
  @ApiProperty({ description: "Google authorization code" })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ description: "PKCE code verifier" })
  @IsString()
  @IsNotEmpty()
  codeVerifier!: string;
}

export class GithubLoginDto {
  @ApiProperty({
    description: "GitHub OAuth authorization code",
    example: "abc123def456"
  })
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class MicrosoftLoginDto {
  @ApiProperty({
    description: "Microsoft ID token",
    example: "eyJhbGciOiJSUzI1NiIs..."
  })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
