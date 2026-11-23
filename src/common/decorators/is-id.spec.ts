import { plainToInstance } from 'class-transformer';
import { IsArray, IsOptional, validateSync } from 'class-validator';

import { uuidOf } from '../../../test/uuid';
import { IsId } from './is-id';

class Body {
  @IsId()
  id!: string;

  @IsOptional()
  @IsArray()
  @IsId({ each: true })
  ids?: string[];
}

const UPPER = '3F2B8C1E-9D4A-4E6F-8A7B-1C2D3E4F5A6B';

describe('IsId', () => {
  const read = (plain: object): { body: Body; refused: string[] } => {
    const body = plainToInstance(Body, plain);
    return { body, refused: validateSync(body).map((error) => error.property) };
  };

  it('takes an id as the database answers it', () => {
    expect(read({ id: uuidOf(7) })).toEqual({ body: { id: uuidOf(7) }, refused: [] });
  });

  it('reads an id typed in upper case as the id the database answers', () => {
    expect(read({ id: UPPER })).toEqual({ body: { id: UPPER.toLowerCase() }, refused: [] });
  });

  it.each([42, '42', 'not-an-id', null, undefined, {}, [uuidOf(7)]])('refuses %p', (id) => {
    expect(read({ id }).refused).toEqual(['id']);
  });

  it('reads each id of a list, and refuses the list for one that is not an id', () => {
    expect(read({ id: uuidOf(1), ids: [uuidOf(2), UPPER] })).toEqual({
      body: { id: uuidOf(1), ids: [uuidOf(2), UPPER.toLowerCase()] },
      refused: [],
    });
    expect(read({ id: uuidOf(1), ids: [uuidOf(2), 3] }).refused).toEqual(['ids']);
    expect(read({ id: uuidOf(1), ids: uuidOf(2) }).refused).toEqual(['ids']);
  });
});
