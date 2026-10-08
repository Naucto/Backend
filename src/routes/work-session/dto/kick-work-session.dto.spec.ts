import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { KickWorkSessionDto } from './kick-work-session.dto';

const errorsOn = (body: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(KickWorkSessionDto, body)).map((error) => error.property);

describe('KickWorkSessionDto', () => {
  it('accepts a user id', () => {
    expect(errorsOn({ userId: 3 })).toEqual([]);
  });

  it.each([1.5, 0, -2])("refuses %p, which is no user's id", (userId) => {
    expect(errorsOn({ userId })).toEqual(['userId']);
  });
});
