import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const projectIdOf = (_data: unknown, context: ExecutionContext): number => {
  const raw: unknown = context.switchToHttp().getRequest().params.id;

  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new BadRequestException('Validation failed (numeric string is expected)');
  }

  return Number(raw);
};

/**
 * The project a route acts on, from `:id` exactly as the URL spells it, digits only.
 *
 * A parameter pipe cannot enforce this: Nest runs global pipes first, and a validation pipe with
 * `transform` has already coerced "12.34e2" to 1234 by then, while the project guards read the raw
 * segment, so the two would name different projects.
 */
export const ProjectId = createParamDecorator(projectIdOf);
