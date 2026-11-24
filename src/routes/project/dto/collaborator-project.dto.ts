import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

import { IsId } from '../../../common/decorators/is-id';

export class AddCollaboratorDto {
  @ApiProperty({
    description: 'User ID of the user to add as collaborator',
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
    required: false,
  })
  @IsOptional()
  @IsId()
  userId?: string;

  @ApiProperty({
    description: 'Username of the user to add as collaborator',
    example: 'john_doe',
    required: false,
  })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({
    description: 'Email of the user to add as collaborator',
    example: 'john.doe@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class RemoveCollaboratorDto {
  @ApiProperty({
    description: 'User ID of the user to remove as collaborator',
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
    required: false,
  })
  @IsOptional()
  @IsId()
  userId?: string;

  @ApiProperty({
    description: 'Username of the user to remove as collaborator',
    example: 'john_doe',
    required: false,
  })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({
    description: 'Email of the user to remove as collaborator',
    example: 'john.doe@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
