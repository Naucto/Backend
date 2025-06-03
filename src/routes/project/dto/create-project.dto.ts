import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsUrl
} from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({
    description: 'The name of the project',
    example: 'MySuperVideoGame'
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'A short description of the project',
    example: 'A 2D platformer game with pixel art graphics'
  })
  @IsString()
  shortDesc!: string;

  @ApiProperty({
    description: 'URL to the project icon',
    example: 'https://example.com/icons/MySuperVideoGame.png',
    required: false
  })
  @IsUrl()
  @IsOptional()
  iconUrl?: string;
}
