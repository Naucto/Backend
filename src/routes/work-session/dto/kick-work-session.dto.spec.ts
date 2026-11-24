import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { uuidOf } from '../../../../test/uuid';
import { KickWorkSessionDto } from './kick-work-session.dto';

const errorsOn = (body: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(KickWorkSessionDto, body)).map((error) => error.property);

describe('KickWorkSessionDto', () => {
  it('accepts a user id', () => {
    expect(errorsOn({ userId: uuidOf(3) })).toEqual([]);
  });

  it.each([3, '3', 'not-an-id', null])("refuses %p, which is no user's id", (userId) => {
    expect(errorsOn({ userId })).toEqual(['userId']);
  });

  it('takes an id in the lower case the database answers it in', () => {
    const upper = 'ABCDEF00-0000-4000-8000-000000000003';

    expect(plainToInstance(KickWorkSessionDto, { userId: upper }).userId).toBe(upper.toLowerCase());
  });
});
