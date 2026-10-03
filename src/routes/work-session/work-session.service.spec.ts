import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { YjsWebRTCServer } from '../../webrtc/server/webrtc.server.yjs';
import { WebRTCService } from '../../webrtc/webrtc.service';
import { WorkSessionService } from './work-session.service';

jest.mock('../../webrtc/server/webrtc.server.yjs');

describe('WorkSessionService', () => {
  let service: WorkSessionService;

  const prismaMock = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    workSession: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const me = { id: 7 } as Parameters<WorkSessionService['join']>[1];

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkSessionService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: WebRTCService,
          useValue: {
            registerServer: jest.fn(),
            shutdownAllServers: jest.fn(),
            buildOffer: jest.fn(),
          },
        },
      ],
    }).compile();

    // Ensure the mock was created without starting a server
    expect(YjsWebRTCServer).toHaveBeenCalledTimes(1);

    service = module.get<WorkSessionService>(WorkSessionService);
  });

  describe('join', () => {
    const HOUR_MS = 60 * 60 * 1000;
    const recorded = (hostId: number, age = 0): object => ({
      id: 1,
      projectId: 5,
      hostId,
      roomId: 'room-uuid',
      lastActiveAt: new Date(Date.now() - age),
    });
    const present = (hostId: number, users: number[]): void => {
      prismaMock.workSession.findUnique.mockResolvedValueOnce({
        id: 1,
        hostId,
        users: users.map((id) => ({ id })),
      });
    };
    const joined = {
      where: { projectId: 5 },
      data: { users: { connect: { id: 7 } }, lastActiveAt: expect.any(Date) },
    };

    it('opens a session with the caller as host when the project has none', async () => {
      prismaMock.workSession.findUnique.mockResolvedValueOnce(null);
      prismaMock.workSession.create.mockResolvedValueOnce(recorded(7));
      present(7, [7]);

      await expect(service.join(5, me)).resolves.toMatchObject({
        roomId: 'room-uuid',
        hostId: 7,
      });
      expect(prismaMock.workSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          project: { connect: { id: 5 } },
          users: { connect: { id: 7 } },
          host: { connect: { id: 7 } },
        }),
      });
    });

    it('joins the session a project already has and reports its host', async () => {
      prismaMock.workSession.findUnique.mockResolvedValueOnce(recorded(3));
      prismaMock.workSession.update.mockResolvedValueOnce(recorded(3));
      present(3, [3, 7]);

      await expect(service.join(5, me)).resolves.toMatchObject({
        roomId: 'room-uuid',
        hostId: 3,
      });
      expect(prismaMock.workSession.update).toHaveBeenCalledWith(joined);
      expect(prismaMock.workSession.create).not.toHaveBeenCalled();
    });

    it('keeps the room of a session nobody joined or left for hours', async () => {
      prismaMock.workSession.findUnique.mockResolvedValueOnce(recorded(3, 7 * HOUR_MS));
      prismaMock.workSession.update.mockResolvedValueOnce(recorded(3));
      present(3, [3, 7]);

      await expect(service.join(5, me)).resolves.toMatchObject({
        roomId: 'room-uuid',
        hostId: 3,
      });
      expect(prismaMock.workSession.create).not.toHaveBeenCalled();
    });

    it('joins the session another collaborator opened at the same moment', async () => {
      prismaMock.workSession.findUnique.mockResolvedValueOnce(null);
      prismaMock.workSession.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('refused', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      prismaMock.workSession.update.mockResolvedValueOnce(recorded(3));
      present(3, [3, 7]);

      await expect(service.join(5, me)).resolves.toMatchObject({
        roomId: 'room-uuid',
        hostId: 3,
      });
      expect(prismaMock.workSession.update).toHaveBeenCalledWith(joined);
    });

    it('rethrows a creation that failed for another reason', async () => {
      const failure = new Error('database is gone');
      prismaMock.workSession.findUnique.mockResolvedValueOnce(null);
      prismaMock.workSession.create.mockRejectedValueOnce(failure);

      await expect(service.join(5, me)).rejects.toBe(failure);
      expect(prismaMock.workSession.update).not.toHaveBeenCalled();
    });

    it('makes the caller host when the recorded host is no longer present', async () => {
      prismaMock.workSession.findUnique.mockResolvedValueOnce(recorded(3));
      prismaMock.workSession.update.mockResolvedValueOnce(recorded(3));
      present(3, [7]);

      await expect(service.join(5, me)).resolves.toMatchObject({ hostId: 7 });
    });
  });

  describe('getInfo', () => {
    it('reports who is in the session of a project', async () => {
      const startedAt = new Date();
      prismaMock.workSession.findFirst.mockResolvedValueOnce({
        id: 1,
        projectId: 5,
        hostId: 3,
        roomId: 'room-uuid',
        startedAt,
        users: [{ id: 3 }, { id: 7 }],
      });

      await expect(service.getInfo(5)).resolves.toEqual({
        users: [3, 7],
        hostId: 3,
        project: 5,
        startedAt,
        roomId: 'room-uuid',
      });
    });

    it('reports a project that has no session', async () => {
      prismaMock.workSession.findFirst.mockResolvedValueOnce(null);

      await expect(service.getInfo(5)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('host election', () => {
    const room = (hostId: number, present: number[]): void => {
      prismaMock.workSession.findFirst.mockResolvedValue({
        id: 1,
        projectId: 5,
        hostId,
        users: present.map((id) => ({ id })),
      });
      prismaMock.workSession.update.mockResolvedValue({});
    };
    const after = (hostId: number, present: number[]): void => {
      prismaMock.workSession.findUnique.mockResolvedValue({
        id: 1,
        hostId,
        users: present.map((id) => ({ id })),
      });
    };
    it('hands the room to the lowest present member when the host leaves', async () => {
      room(7, [7, 9, 3]);
      after(7, [9, 3]);

      await service.leave(5, me);

      expect(prismaMock.workSession.update).toHaveBeenLastCalledWith({
        where: { id: 1 },
        data: { host: { connect: { id: 3 } } },
      });
    });

    it('leaves the host alone when somebody else leaves', async () => {
      room(3, [7, 9, 3]);
      after(3, [9, 3]);

      await service.leave(5, me);

      expect(prismaMock.workSession.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.workSession.update.mock.calls[0]![0].data).not.toHaveProperty('host');
    });

    it('elects when the host is kicked', async () => {
      room(7, [7, 9, 3]);
      after(7, [9, 3]);

      await service.kick(5, 7);

      expect(prismaMock.workSession.update).toHaveBeenLastCalledWith({
        where: { id: 1 },
        data: { host: { connect: { id: 3 } } },
      });
    });

    it('keeps the recorded host over an empty room', async () => {
      room(7, [7]);
      after(7, []);

      await service.leave(5, me);

      expect(prismaMock.workSession.update).toHaveBeenCalledTimes(1);
    });
  });
});
