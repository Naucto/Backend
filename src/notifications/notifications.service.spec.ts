import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { WebRTCService } from '../webrtc/webrtc.service';
import { NotificationsService } from './notifications.service';

const mockNotificationServer = {
  sendToUser: jest.fn(),
};

jest.mock('./notifications.webrtc-server', () => ({
  NotificationWebRTCServer: jest.fn().mockImplementation(() => mockNotificationServer),
}));

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    $transaction: jest.Mock;
    notification: {
      create: jest.Mock;
      deleteMany: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    user: {
      findUnique: jest.Mock;
    };
  };
  let webrtcService: { buildOffer: jest.Mock };

  const notificationRecord = {
    id: 7,
    userId: 42,
    title: 'Build complete',
    message: 'Your build is ready.',
    type: 'INFO' as const,
    kind: 'GENERIC' as const,
    data: null,
    read: false,
    createdAt: new Date('2026-06-07T09:00:00.000Z'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
      ),
      notification: {
        create: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    webrtcService = {
      buildOffer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: WebRTCService,
          useValue: webrtcService,
        },
        {
          provide: JwtService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should build a websocket offer from the notification server', () => {
    const offer = { signaling: ['ws://localhost:4098'] };
    webrtcService.buildOffer.mockReturnValue(offer);

    expect(service.getWebRTCOffer()).toBe(offer);
    expect(webrtcService.buildOffer).toHaveBeenCalledWith(mockNotificationServer);
  });

  it.each([
    ['a live account', { deletedAt: null }, true],
    ['a deleted account', { deletedAt: new Date('2026-09-01T00:00:00Z') }, false],
    ['an account that is gone', null, false],
  ])('should tell whether a user can still sign in (%s)', async (_case, row, active) => {
    prisma.user.findUnique.mockResolvedValue(row);

    await expect(service.isActiveUser(42)).resolves.toBe(active);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { deletedAt: true },
    });
  });

  it('should return the latest notifications as API payloads', async () => {
    prisma.notification.findMany.mockResolvedValue([notificationRecord]);

    await expect(service.getUserNotifications(42)).resolves.toEqual([
      {
        id: '7',
        userId: 42,
        title: 'Build complete',
        message: 'Your build is ready.',
        type: 'INFO',
        kind: 'GENERIC',
        data: null,
        read: false,
        createdAt: '2026-06-07T09:00:00.000Z',
      },
    ]);

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId: 42 },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  it('logs a notification it cannot write instead of raising it', async () => {
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma.$transaction.mockRejectedValueOnce(new Error('database down'));

    await expect(
      service.notifyBestEffort({ userId: 42, title: 'Hi', message: 'Hello', type: 'INFO' }),
    ).resolves.toBeUndefined();

    expect(warned).toHaveBeenCalledTimes(1);
    warned.mockRestore();
  });

  it('should create a notification, prune old records, and send it in realtime', async () => {
    prisma.notification.create.mockResolvedValue(notificationRecord);
    prisma.notification.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.notification.deleteMany.mockResolvedValue({ count: 2 });

    await expect(
      service.createNotification({
        userId: 42,
        title: 'Build complete',
        message: 'Your build is ready.',
        type: 'INFO',
      }),
    ).resolves.toEqual({
      id: '7',
      userId: 42,
      title: 'Build complete',
      message: 'Your build is ready.',
      type: 'INFO',
      kind: 'GENERIC',
      data: null,
      read: false,
      createdAt: '2026-06-07T09:00:00.000Z',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 42,
        title: 'Build complete',
        message: 'Your build is ready.',
        type: 'INFO',
        kind: 'GENERIC',
      },
    });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: [1, 2] },
      },
    });
    expect(mockNotificationServer.sendToUser).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ id: '7', userId: 42 }),
    );
  });

  it('should persist the kind and data payload when provided', async () => {
    prisma.notification.create.mockResolvedValue({
      ...notificationRecord,
      kind: 'FRIEND_REQUEST',
      data: { requestId: 3, fromUserId: 9 },
    });
    prisma.notification.findMany.mockResolvedValue([]);

    const payload = await service.createNotification({
      userId: 42,
      title: 'New friend request',
      message: 'x wants to be your friend',
      type: 'INFO',
      kind: 'FRIEND_REQUEST',
      data: { requestId: 3, fromUserId: 9 },
    });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'FRIEND_REQUEST',
        data: { requestId: 3, fromUserId: 9 },
      }),
    });
    expect(payload.kind).toBe('FRIEND_REQUEST');
    expect(payload.data).toEqual({ requestId: 3, fromUserId: 9 });
  });

  it('should not prune when the user has no extra notifications', async () => {
    prisma.notification.create.mockResolvedValue(notificationRecord);
    prisma.notification.findMany.mockResolvedValue([]);

    await service.createNotification({
      userId: 42,
      title: 'Build complete',
      message: 'Your build is ready.',
      type: 'INFO',
    });

    expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
  });

  it('should mark one notification as read', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.findUnique.mockResolvedValue({
      ...notificationRecord,
      read: true,
    });

    await expect(service.markAsRead(42, '7')).resolves.toEqual({
      id: '7',
      userId: 42,
      title: 'Build complete',
      message: 'Your build is ready.',
      type: 'INFO',
      kind: 'GENERIC',
      data: null,
      read: true,
      createdAt: '2026-06-07T09:00:00.000Z',
    });

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 7, userId: 42 },
      data: { read: true },
    });
  });

  it('should reject malformed notification ids', async () => {
    await expect(service.markAsRead(42, 'abc')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it('should reject notifications owned by another user', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.markAsRead(42, '7')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 7, userId: 42 },
      data: { read: true },
    });
    expect(prisma.notification.findUnique).not.toHaveBeenCalled();
  });

  it('should mark all unread notifications as read', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.markAllAsRead(42)).resolves.toBe(3);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 42,
        read: false,
      },
      data: {
        read: true,
      },
    });
  });
});
