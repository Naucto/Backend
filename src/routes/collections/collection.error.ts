import { HttpException, HttpStatus } from '@nestjs/common';

import { COLLECTION_GAMES_MAX, COLLECTIONS_PER_USER_MAX } from './collection-limits';
import type { CollectionLimitDto } from './dto/collection.dto';

const LIMITS = {
  COLLECTIONS_LIMIT: {
    max: COLLECTIONS_PER_USER_MAX,
    message: `${COLLECTIONS_PER_USER_MAX} collections at most - delete one to create another`,
  },
  COLLECTION_GAMES_LIMIT: {
    max: COLLECTION_GAMES_MAX,
    message: `${COLLECTION_GAMES_MAX} games at most in a collection - remove one to add another`,
  },
} as const;

export type CollectionLimitCode = keyof typeof LIMITS;
export const COLLECTION_LIMIT_CODES = Object.keys(LIMITS) as CollectionLimitCode[];

/** Raised when a count a collection is held to is reached. */
export class CollectionLimitException extends HttpException {
  constructor(readonly code: CollectionLimitCode) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code,
        ...LIMITS[code],
      } satisfies CollectionLimitDto,
      HttpStatus.BAD_REQUEST,
    );
  }
}
