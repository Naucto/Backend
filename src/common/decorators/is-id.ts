import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsUUID, ValidationOptions } from 'class-validator';

function lowerCased(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(lowerCased);
  }
  return typeof value === 'string' ? value.toLowerCase() : value;
}

/**
 * An id in a body or a query, taken in the lower case the database answers ids in. A UUID reads
 * the same in either case, so an id left as typed would name a row without being equal to the id
 * read from it.
 */
export function IsId(options?: ValidationOptions): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => lowerCased(value)),
    IsUUID(undefined, options),
  );
}
