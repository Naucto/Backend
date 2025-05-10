import { ApiProperty } from '@nestjs/swagger';
import { Project } from '../../project/entities/project.entity';

export class WorkSession {
  @ApiProperty({
    example: 1,
    description: 'The unique identifier of the work session',
  })
  id: number;

  @ApiProperty({
    example: 1,
    description: 'The ID of the project this work session belongs to',
  })
  projectId: number;

  @ApiProperty({
    example: 1,
    description: 'The ID of the user who created this work session',
  })
  userId: number;

  @ApiProperty({
    example: '2023-04-15T12:00:00Z',
    description: 'The date and time when the work session started',
  })
  startTime: Date;

  @ApiProperty({
    example: '2023-04-15T14:30:00Z',
    description: 'The date and time when the work session ended',
    required: false,
  })
  endTime?: Date;

  @ApiProperty({
    example: 120,
    description: 'Duration in minutes',
    required: false,
  })
  durationMinutes?: number;

  @ApiProperty({
    example: 'Completed the login functionality',
    description: 'Notes about the work session',
    required: false,
  })
  notes?: string;

  @ApiProperty({
    description: 'The project this work session belongs to',
    type: () => Project,
  })
  project?: Project;

  @ApiProperty({
    example: '2023-04-15T12:00:00Z',
    description: 'The date and time when the work session was created',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2023-04-15T14:30:00Z',
    description: 'The date and time when the work session was last updated',
  })
  updatedAt: Date;
}
