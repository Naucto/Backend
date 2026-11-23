import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { uuidOf } from '../../../test/uuid';
import { ADMIN, MODERATOR, USER, VIEWER } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationLogService } from '../moderation/moderation-log.service';
import { AdminAccountService } from './admin-account.service';
import { AdminAccountRow } from './admin-session.service';

describe('AdminAccountService', () => {
  let rows: Map<string, AdminAccountRow>;
  let service: AdminAccountService;
  const log = { record: jest.fn() };
  const users = {
    findUnique: jest.fn(({ where }: { where: { id: string } }) => rows.get(where.id)),
    findMany: jest.fn(async (_query: object) => [...rows.values()]),
    count: jest.fn(
      async () => [...rows.values()].filter((row) => row.role === ADMIN && !row.deletedAt).length,
    ),
    update: jest.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<AdminAccountRow> }) => {
        const next = { ...rows.get(where.id)!, ...data };
        rows.set(where.id, next);
        return next;
      },
    ),
  };
  const transaction = { user: users };
  const prisma = {
    $transaction: jest.fn((run: (tx: typeof transaction) => unknown) => run(transaction)),
    user: users,
  };

  const row = (overrides: Partial<AdminAccountRow>): AdminAccountRow => ({
    id: uuidOf(1),
    username: 'ada',
    nickname: null,
    email: 'ada@example.com',
    role: ADMIN,
    createdAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    rows = new Map([
      [uuidOf(1), row({})],
      [uuidOf(2), row({ id: uuidOf(2), username: 'bob', email: 'bob@example.com', role: USER })],
    ]);
    jest.clearAllMocks();
    service = new AdminAccountService(
      prisma as unknown as PrismaService,
      log as unknown as ModerationLogService,
    );
  });

  it('lists admins with their address for an admin, without it for a viewer', async () => {
    const asAdmin = await service.admins(ADMIN);
    const asViewer = await service.admins(VIEWER);

    expect(asAdmin.items[0]?.email).toBe('ada@example.com');
    expect(asViewer.items.every((item) => item.email === null)).toBe(true);
  });

  it('searches addresses only for a reader who would be shown them', async () => {
    await service.search('example', ADMIN);
    await service.search('example', VIEWER);

    const [asAdmin, asViewer] = prisma.user.findMany.mock.calls.map(([query]) =>
      JSON.stringify(query),
    );
    expect(asAdmin).toContain('email');
    expect(asViewer).not.toContain('"email":{');
  });

  it('makes an account a viewer', async () => {
    await expect(service.setRole(uuidOf(1), uuidOf(2), VIEWER)).resolves.toMatchObject({
      id: uuidOf(2),
      role: VIEWER,
    });
  });

  it('promotes an account to admin, and demotes it back', async () => {
    await expect(service.setRole(uuidOf(1), uuidOf(2), ADMIN)).resolves.toMatchObject({
      id: uuidOf(2),
      role: ADMIN,
    });
    await expect(service.setRole(uuidOf(1), uuidOf(2), USER)).resolves.toMatchObject({
      id: uuidOf(2),
      role: USER,
    });
  });

  it('lists whoever signs in to the console, and nobody else', async () => {
    await service.staff(ADMIN);

    expect(prisma.user.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { role: { in: [VIEWER, MODERATOR, ADMIN] }, deletedAt: null },
    });
  });

  it('writes a role change to the log, with the role left and the role taken', async () => {
    await service.setRole(uuidOf(1), uuidOf(2), MODERATOR);

    expect(log.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        action: 'ROLE_CHANGED',
        actorId: uuidOf(1),
        targetType: 'USER',
        targetId: uuidOf(2),
        subjectUserId: uuidOf(2),
        internalNote: 'From User to Moderator',
      }),
    );
  });

  it('writes nothing when the account already holds the role', async () => {
    await expect(service.setRole(uuidOf(1), uuidOf(2), USER)).resolves.toMatchObject({
      id: uuidOf(2),
      role: USER,
    });

    expect(log.record).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: uuidOf(2) } }),
    );
  });

  it('never changes your own role', async () => {
    await expect(service.setRole(uuidOf(1), uuidOf(1), USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('keeps the last admin one', async () => {
    rows.set(uuidOf(3), row({ id: uuidOf(3), role: USER }));
    rows.set(uuidOf(1), row({ deletedAt: new Date() }));
    rows.set(uuidOf(4), row({ id: uuidOf(4) }));

    await expect(service.setRole(uuidOf(3), uuidOf(4), USER)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('does not touch a deleted account', async () => {
    rows.set(uuidOf(2), row({ id: uuidOf(2), role: USER, deletedAt: new Date() }));

    await expect(service.setRole(uuidOf(1), uuidOf(2), ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
