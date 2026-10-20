import { Prisma } from '@prisma/client';

import { withEnv } from '../../../test/env';
import { addressViewKey, viewerKeyOf } from './viewer-key';

describe('viewerKeyOf', () => {
  const tx = { $executeRaw: jest.fn() };
  const keyOf = (userId: number | null, address = '203.0.113.9'): Promise<string | null> =>
    viewerKeyOf(tx as unknown as Prisma.TransactionClient, { userId, address });

  beforeEach(() => {
    jest.clearAllMocks();
    withEnv({ VIEW_HASH_SECRET: 'viewer-key-spec-secret' });
  });

  it('keys a signed-in reader by the account, under its shared identity lock', async () => {
    await expect(keyOf(7)).resolves.toBe('u:7');

    const [lock] = tx.$executeRaw.mock.calls;
    expect((lock?.[0] as TemplateStringsArray).join('?')).toContain(
      'pg_advisory_xact_lock_shared(',
    );
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
  beforeEach(() => {
    withEnv({ VIEW_HASH_SECRET: 'viewer-key-spec-secret' });
  });

  it('gives one address one code, and two addresses two', () => {
    expect(addressViewKey('203.0.113.9')).toBe(addressViewKey('203.0.113.9'));
    expect(addressViewKey('203.0.113.9')).not.toBe(addressViewKey('203.0.113.10'));
  });

  it('reads an IPv4-mapped address as the plain IPv4 address', () => {
    expect(addressViewKey('::ffff:203.0.113.9')).toBe(addressViewKey('203.0.113.9'));
  });

  it('changes every code when the secret changes', () => {
    const before = addressViewKey('203.0.113.9');
    withEnv({ VIEW_HASH_SECRET: 'another-secret' });

    expect(addressViewKey('203.0.113.9')).not.toBe(before);
  });
});
