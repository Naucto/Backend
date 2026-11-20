import { ADMIN, MODERATOR, USER } from '../../auth/access/roles';
import { AccountRefRow, contentOf, labelOf, toAccountRef } from './moderation-mappers';

const account = (overrides: Partial<AccountRefRow> = {}): AccountRefRow => ({
  id: 7,
  username: 'louis',
  nickname: null,
  role: USER,
  email: 'louis@example.com',
  deletedAt: null,
  ...overrides,
});

describe('toAccountRef', () => {
  it('gives the address to an admin', () => {
    expect(toAccountRef(account(), { id: 1, role: ADMIN }).email).toBe('louis@example.com');
  });

  it('keeps the address from a moderator', () => {
    expect(toAccountRef(account(), { id: 1, role: MODERATOR }).email).toBeNull();
  });

  it('links no profile once the account is erased', () => {
    const ref = toAccountRef(account({ deletedAt: new Date() }), { id: 1, role: ADMIN });

    expect(ref).toMatchObject({ deleted: true, profileUrl: null });
  });
});

describe('contentOf', () => {
  it('reads a stored snapshot back', () => {
    expect(contentOf({ title: 'Ferry Click', body: 'A game' })).toEqual({
      title: 'Ferry Click',
      body: 'A game',
    });
  });

  it.each([[null], ['text'], [[1, 2]], [42]])('reads %j as no snapshot', (value) => {
    expect(contentOf(value)).toBeNull();
  });

  it('reads a field that is not text as absent', () => {
    expect(contentOf({ title: 3, body: null })).toEqual({ title: null, body: null });
  });
});

describe('labelOf', () => {
  it('prefers the title', () => {
    expect(labelOf({ title: 'Ferry Click', body: 'A game' })).toBe('Ferry Click');
  });

  it('falls back to the start of the text', () => {
    const label = labelOf({ title: null, body: 'x'.repeat(200) });

    expect(label).toHaveLength(81);
    expect(label?.endsWith('…')).toBe(true);
  });

  it('has nothing to say without a snapshot', () => {
    expect(labelOf(null)).toBeNull();
  });
});
