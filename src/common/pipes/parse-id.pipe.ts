import { ArgumentMetadata, Injectable, ParseUUIDPipe } from '@nestjs/common';

/**
 * An id from a URL, in the lower case the database answers ids in. A UUID reads the same in either
 * case, so an id left as typed would name a row without being equal to the id read from it.
 */
@Injectable()
export class ParseIdPipe extends ParseUUIDPipe {
  override async transform(value: string, metadata: ArgumentMetadata): Promise<string> {
    const id = await super.transform(value, metadata);
    // `optional: true` lets an absent value through as it came.
    return typeof id === 'string' ? id.toLowerCase() : id;
  }
}
