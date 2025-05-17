import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'User username', example: 'xX_DarkGamer_Xx' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ description: 'User nick name', example: 'John Doe', required: false })
  @IsString()
  @IsOptional()
  nickname?: string;

  @ApiProperty({ description: 'User password', example: 'password123' })
  @IsString()
  @MinLength(6)
  @IsNotEmpty()
  password: string;

  @ApiProperty({
    description: 'List of Role IDs to assign to the user',
    example: [2],
    required: false,
  })
  @IsOptional()
  @IsArray()
  roles?: number[];
}
