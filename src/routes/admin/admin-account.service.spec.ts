import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { ADMIN, USER } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAccountService } from './admin-account.service';
import { AdminAccountRow } from './admin-session.service';

describe('AdminAccountService', () => {
  let rows: Map<number, AdminAccountRow>;
  let service: AdminAccountService;
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: number } }) => rows.get(where.id)),
      count: jest.fn(
        async () => [...rows.values()].filter((row) => row.role === ADMIN && !row.deletedAt).length,
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: number }; data: Partial<AdminAccountRow> }) => {
          const next = { ...rows.get(where.id)!, ...data };
          rows.set(where.id, next);
          return next;
        },
      ),
    },
  };

  const row = (overrides: Partial<AdminAccountRow>): AdminAccountRow => ({
    id: 1,
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
      [1, row({})],
      [2, row({ id: 2, username: 'bob', email: 'bob@example.com', role: USER })],
    ]);
    service = new AdminAccountService(prisma as unknown as PrismaService);
  });

  it('promotes an account to admin, and demotes it back', async () => {
    await expect(service.setRole(1, 2, ADMIN)).resolves.toMatchObject({ id: 2, role: ADMIN });
    await expect(service.setRole(1, 2, USER)).resolves.toMatchObject({ id: 2, role: USER });
  });

  it('never changes your own role', async () => {
    await expect(service.setRole(1, 1, USER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the last admin one', async () => {
    rows.set(3, row({ id: 3, role: USER }));
    rows.set(1, row({ deletedAt: new Date() }));
    rows.set(4, row({ id: 4 }));

    await expect(service.setRole(3, 4, USER)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not touch a deleted account', async () => {
    rows.set(2, row({ id: 2, role: USER, deletedAt: new Date() }));

    await expect(service.setRole(1, 2, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });
});
