import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsInt, IsOptional, IsString, Validate } from "class-validator";
import { AtLeastOneConstraint } from "@common/decorators/at-least-one";

export class AddCollaboratorDto {
  @ApiProperty({
    description: "User ID of the user to add as collaborator",
    example: 42,
    required: false
  })
  @IsOptional()
  @IsInt()
  @Validate(AtLeastOneConstraint, [['userId', 'username', 'email']])
  userId?: number;

  @ApiProperty({
    description: "Username of the user to add as collaborator",
    example: "john_doe",
    required: false
  })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({
    description: "Email of the user to add as collaborator",
    example: "john.doe@example.com",
    required: false
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class RemoveCollaboratorDto {
  @ApiProperty({
    description: "User ID of the user to remove as collaborator",
    example: 42,
    required: false
  })
  @IsOptional()
  @IsInt()
  @Validate(AtLeastOneConstraint, [['userId', 'username', 'email']])
  userId?: number;

  @ApiProperty({
    description: "Username of the user to remove as collaborator",
    example: "john_doe",
    required: false
  })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({
    description: "Email of the user to remove as collaborator",
    example: "john.doe@example.com",
    required: false
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
