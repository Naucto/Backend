import { ArgumentMetadata, BadRequestException } from '@nestjs/common';

import { uuidOf } from '../../../test/uuid';
import { ParseIdPipe } from './parse-id.pipe';

describe('ParseIdPipe', () => {
  const metadata: ArgumentMetadata = { type: 'param', data: 'id' };
  const pipe = new ParseIdPipe();

  it('takes an id as the database answers it', async () => {
    await expect(pipe.transform(uuidOf(7), metadata)).resolves.toBe(uuidOf(7));
  });

  it('reads an id typed in upper case as the id the database answers', async () => {
    await expect(pipe.transform('3F2B8C1E-9D4A-4E6F-8A7B-1C2D3E4F5A6B', metadata)).resolves.toBe(
      '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
    );
  });

  it.each(['42', 'not-an-id', '', `${uuidOf(7)}0`])('refuses %p', async (value) => {
    await expect(pipe.transform(value, metadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an absent id', async () => {
    await expect(pipe.transform(undefined as unknown as string, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lets an absent id through when it is optional', async () => {
    const optional = new ParseIdPipe({ optional: true });

    await expect(
      optional.transform(undefined as unknown as string, metadata),
    ).resolves.toBeUndefined();
    await expect(optional.transform('42', metadata)).rejects.toBeInstanceOf(BadRequestException);
  });
});
