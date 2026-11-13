import { Prisma } from '@prisma/client';

import { addressViewKey, viewerKeyOf } from './viewer-key';

const SALT = Buffer.from('viewer-key-spec-salt');

describe('viewerKeyOf', () => {
  const tx = { $executeRaw: jest.fn(), user: { findUnique: jest.fn() } };
  const keyOf = (userId: number | null, address = '203.0.113.9'): Promise<string | null> =>
    viewerKeyOf(tx as unknown as Prisma.TransactionClient, { userId, address }, SALT);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.user.findUnique.mockResolvedValue({ deletedAt: null });
  });

  it('keys a signed-in reader by the account, read under its shared identity lock', async () => {
    await expect(keyOf(7)).resolves.toBe('u:7');

    const [lock] = tx.$executeRaw.mock.calls;
    expect((lock?.[0] as TemplateStringsArray).join('?')).toContain(
      'pg_advisory_xact_lock_shared(',
    );
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.user.findUnique.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it.each([
    ['deleted', { deletedAt: new Date('2026-09-01T00:00:00Z') }],
    ['missing', null],
  ])('has no key for an account found %s under the lock', async (_state, account) => {
    tx.user.findUnique.mockResolvedValue(account);

    await expect(keyOf(7)).resolves.toBeNull();
  });

  it('keys anyone else by a code of the address that does not show the address', async () => {
    const key = await keyOf(null);

    expect(key).toMatch(/^addr:[\w-]{22}$/);
    expect(key).not.toContain('203');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('has no key without an address', async () => {
    await expect(keyOf(null, '')).resolves.toBeNull();
  });
});

describe('addressViewKey', () => {
  it('gives one address one code, and two addresses two', () => {
    expect(addressViewKey('203.0.113.9', SALT)).toBe(addressViewKey('203.0.113.9', SALT));
    expect(addressViewKey('203.0.113.9', SALT)).not.toBe(addressViewKey('203.0.113.10', SALT));
  });

  it('changes every code when the salt changes', () => {
    expect(addressViewKey('203.0.113.9', Buffer.from('another-salt'))).not.toBe(
      addressViewKey('203.0.113.9', SALT),
    );
  });
});
