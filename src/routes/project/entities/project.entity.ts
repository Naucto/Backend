import { ApiProperty } from '@nestjs/swagger';

export class Project {
  @ApiProperty({
    example: 1,
    description: 'The unique identifier of the project',
  })
  id: number;

  @ApiProperty({
    example: 'E-commerce Platform',
    description: 'The name of the project',
  })
  name: string;

  @ApiProperty({
    example: 'An online shopping platform with integrated payment processing',
    description: 'A short description of the project',
  })
  shortDesc: string;

  @ApiProperty({
    example:
      'This e-commerce platform includes user authentication, product catalog...',
    description: 'A detailed description of the project',
    required: false,
  })
  longDesc?: string;

  @ApiProperty({
    example: 'https://example.com/icons/ecommerce.png',
    description: 'URL to the project icon',
    required: false,
  })
  iconUrl?: string;

  @ApiProperty({
    example: 'ecommerce-platform.zip',
    description: 'The file name associated with the project',
    required: false,
  })
  fileName?: string;

  @ApiProperty({
    example: 99.99,
    description: 'The price of the project',
    required: false,
  })
  price?: number;

  @ApiProperty({
    example: 1,
    description: 'The ID of the user who owns this project',
  })
  userId: number;

  @ApiProperty({
    example: '2023-04-15T12:00:00Z',
    description: 'The date and time when the project was created',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2023-04-15T14:30:00Z',
    description: 'The date and time when the project was last updated',
  })
  updatedAt: Date;
}
