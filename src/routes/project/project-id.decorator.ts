import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { isUUID } from 'class-validator';

export const projectIdOf = (_data: unknown, context: ExecutionContext): string => {
  const raw: unknown = context.switchToHttp().getRequest().params.id;

  if (typeof raw !== 'string' || !isUUID(raw)) {
    throw new BadRequestException('Validation failed (uuid is expected)');
  }

  return raw.toLowerCase();
};

/**
 * The project a route acts on, from `:id` as the URL spells it: the segment the project guards
 * read, in the lower case the database answers ids in.
 */
export const ProjectId = createParamDecorator(projectIdOf);
