import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsUrl, Min } from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({
    description: 'The name of the project',
    example: 'E-commerce Platform',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'A short description of the project',
    example: 'An online shopping platform with integrated payment processing',
  })
  @IsString()
  shortDesc: string;

  @ApiProperty({
    description: 'A detailed description of the project',
    example: 'This e-commerce platform includes user authentication, product catalog, shopping cart, and payment processing features...',
    required: false,
  })
  @IsString()
  @IsOptional()
  longDesc?: string;

  @ApiProperty({
    description: 'URL to the project icon',
    example: 'https://example.com/icons/ecommerce.png',
    required: false,
  })
  @IsUrl()
  @IsOptional()
  iconUrl?: string;

  @ApiProperty({
    description: 'The file name associated with the project',
    example: 'ecommerce-platform.zip',
    required: false,
  })
  @IsString()
  @IsOptional()
  fileName?: string;

  @ApiProperty({
    description: 'The price of the project',
    example: 99.99,
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;
}