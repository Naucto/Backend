import { createHash } from 'node:crypto';

import { ConflictException, UnauthorizedException } from '@nestjs/common';

import { uuidOf } from '../../../test/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService, AiTokenError } from './ai.service';

const OWNER = uuidOf(1);
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

type Row = Record<string, unknown> & { id: string };

/** Just enough of Prisma for the device flow: two tables held in memory. */
function memoryPrisma(): { prisma: PrismaService; codes: Row[]; grants: Row[]; projects: Row[] } {
  const codes: Row[] = [];
  const grants: Row[] = [];
  const projects: Row[] = [];
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, want]) => {
      if (want && typeof want === 'object' && !(want instanceof Date)) {
        const gt = (want as { gt?: Date }).gt;
        return gt ? (row[key] as Date) > gt : true;
      }
      return row[key] === want;
    });
  const table = (rows: Row[]): Record<string, jest.Mock> => ({
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: uuidOf(rows.length + 100),
        approved: null,
        userId: null,
        lastPolledAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        ...data,
      };
      rows.push(row);
      return row;
    }),
    findUnique: jest.fn(
      ({ where }: { where: Record<string, unknown> }) =>
        rows.find((row) => matches(row, where)) ?? null,
    ),
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((row) => matches(row, where)),
    ),
    update: jest.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Object.assign(rows.find((row) => row.id === where.id) ?? {}, data),
    ),
    updateMany: jest.fn(
      ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = rows.filter((row) => matches(row, where));
        hit.forEach((row) => Object.assign(row, data));
        return { count: hit.length };
      },
    ),
    delete: jest.fn(
      ({ where }: { where: { id: string } }) =>
        rows.splice(
          rows.findIndex((row) => row.id === where.id),
          1,
        )[0],
    ),
    deleteMany: jest.fn(async ({ where }: { where: { id: string } }) => {
      const at = rows.findIndex((row) => row.id === where.id);
      return { count: at < 0 ? 0 : rows.splice(at, 1).length };
    }),
  });
  const prisma = {
    aiDeviceCode: table(codes),
    aiGrant: table(grants),
    project: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        projects.filter((row) => matches(row, where)),
      ),
    },
  } as unknown as PrismaService;
  return { prisma, codes, grants, projects };
}

describe('AiService: connecting an assistant with a code', () => {
  let store: ReturnType<typeof memoryPrisma>;
  let service: AiService;

  beforeEach(() => {
    store = memoryPrisma();
    service = new AiService(store.prisma);
    store.projects.push({ id: uuidOf(5), name: 'Cave', userId: OWNER });
  });

  it('waits for the owner, then hands out tokens that reach their project, once', async () => {
    const asked = await service.startDevice({ clientName: 'Codex on the server' });
    expect(asked.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(asked.verification_uri_complete).toContain(asked.user_code);
    expect(JSON.stringify(store.codes)).not.toContain(asked.device_code);

    await expect(service.exchangeDevice(asked.device_code)).rejects.toMatchObject({
      code: 'authorization_pending',
    });
    await expect(service.exchangeDevice(asked.device_code)).rejects.toMatchObject({
      code: 'slow_down',
    });

    await expect(service.describeDevice(asked.user_code.toLowerCase())).resolves.toMatchObject({
      clientName: 'Codex on the server',
    });
    await service.answerDevice(asked.user_code, OWNER, true);
    const tokens = await service.exchangeDevice(asked.device_code);
    expect(tokens.access_token).toMatch(/^naucto_at_[a-f0-9]{64}$/);
    expect(store.grants[0]).toMatchObject({
      userId: OWNER,
      accessTokenHash: hash(tokens.access_token),
    });
    await expect(service.exchangeDevice(asked.device_code)).rejects.toBeInstanceOf(AiTokenError);

    await expect(service.connection(`Bearer ${tokens.access_token}`)).resolves.toMatchObject({
      projectId: uuidOf(5),
      userId: OWNER,
    });
  });

  it('refuses what the owner refused', async () => {
    const asked = await service.startDevice({});
    await service.answerDevice(asked.user_code, OWNER, false);
    await expect(service.exchangeDevice(asked.device_code)).rejects.toMatchObject({
      code: 'access_denied',
    });
  });

  it('replaces the refresh token at each use, and a revoked grant reaches nothing', async () => {
    const asked = await service.startDevice({});
    await service.answerDevice(asked.user_code, OWNER, true);
    const first = await service.exchangeDevice(asked.device_code);
    const second = await service.refresh(first.refresh_token);
    await expect(service.refresh(first.refresh_token)).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    await expect(service.connection(`Bearer ${first.access_token}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await service.revokeGrant(OWNER, store.grants[0]!.id);
    await expect(service.connection(`Bearer ${second.access_token}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.refresh(second.refresh_token)).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });

  it('will not guess between several projects, and reaches none of somebody else', async () => {
    store.projects.push({ id: uuidOf(6), name: 'Ferry', userId: OWNER });
    const asked = await service.startDevice({});
    await service.answerDevice(asked.user_code, OWNER, true);
    const { access_token } = await service.exchangeDevice(asked.device_code);
    await expect(service.connection(`Bearer ${access_token}`)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.connection(`Bearer ${access_token}`, uuidOf(6))).resolves.toMatchObject({
      projectId: uuidOf(6),
    });
    await expect(service.connection(`Bearer ${access_token}`, uuidOf(9))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.connection('Bearer some-jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
