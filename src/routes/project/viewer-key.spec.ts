import { Prisma } from '@prisma/client';

import { viewerKeyOf } from './viewer-key';

const VISITOR = '11111111-1111-4111-8111-111111111111';

describe('viewerKeyOf', () => {
  const tx = {
    $executeRaw: jest.fn(),
    analyticsVisitorTombstone: { findUnique: jest.fn() },
    analyticsVisitor: { findUnique: jest.fn() },
  };
  const keyOf = (): Promise<string | null> =>
    viewerKeyOf(tx as unknown as Prisma.TransactionClient, VISITOR);

  beforeEach(() => {
    jest.clearAllMocks();
    tx.analyticsVisitorTombstone.findUnique.mockResolvedValue(null);
    tx.analyticsVisitor.findUnique.mockResolvedValue(null);
  });

  it('keys a browser linked to an account by the account', async () => {
    tx.analyticsVisitor.findUnique.mockResolvedValue({ userId: 7 });

    await expect(keyOf()).resolves.toBe('u:7');
  });

  it('keys an unlinked browser by its visitor, stored or not yet', async () => {
    await expect(keyOf()).resolves.toBe(`v:${VISITOR}`);

    tx.analyticsVisitor.findUnique.mockResolvedValue({ userId: null });
    await expect(keyOf()).resolves.toBe(`v:${VISITOR}`);
  });

  it('has no key for an erased visitor', async () => {
    tx.analyticsVisitorTombstone.findUnique.mockResolvedValue({ id: VISITOR });

    await expect(keyOf()).resolves.toBeNull();
    expect(tx.analyticsVisitor.findUnique).not.toHaveBeenCalled();
  });

  it('takes the visitor lock before reading anything', async () => {
    await keyOf();

    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.analyticsVisitorTombstone.findUnique.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
