import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';

import { PresenceServerMessage } from '../presence/dto/presence-message.dto';
import { PresenceSocketHandler } from '../presence/presence.types';
import { PrismaService } from '../prisma/prisma.service';
import { WebRTCOfferDto } from '../webrtc/webrtc.dto';
import { WebRTCService } from '../webrtc/webrtc.service';
import {
  CreateNotificationInput,
  NotificationData,
  NotificationKind,
  NotificationPayload,
  NotificationType,
} from './notifications.types';
import { NotificationWebRTCServer } from './notifications.webrtc-server';

const MAX_NOTIFICATIONS_PER_USER = 50;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly notificationServer: NotificationWebRTCServer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webrtcService: WebRTCService,
    jwtService: JwtService,
  ) {
    this.notificationServer = new NotificationWebRTCServer(
      this.webrtcService,
      'Notifications',
      jwtService,
      this,
    );
  }

  attachPresence(handler: PresenceSocketHandler): void {
    this.notificationServer.setPresenceHandler(handler);
  }

  sendPresenceToUser(userId: number, message: PresenceServerMessage): void {
    this.notificationServer.sendMessageToUser(userId, message);
  }

  getWebRTCOffer(): WebRTCOfferDto {
    return this.webrtcService.buildOffer(this.notificationServer);
  }

  /** False for a soft-deleted account, whose row and still-valid tokens outlive it. */
  async isActiveUser(userId: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });

    return user !== null && user.deletedAt === null;
  }

  async getUserNotifications(userId: number): Promise<NotificationPayload[]> {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_NOTIFICATIONS_PER_USER,
    });

    return notifications.map((notification) => this.toPayload(notification));
  }

  /**
   * Notifies about a change the caller has already written, logging a failure instead of raising
   * it: the caller must not answer that its change failed when only the notice about it did.
   */
  async notifyBestEffort(input: CreateNotificationInput): Promise<void> {
    try {
      await this.createNotification(input);
    } catch (error) {
      this.logger.warn(
        `Could not notify user ${input.userId} (${input.kind ?? 'GENERIC'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async createNotification(input: CreateNotificationInput): Promise<NotificationPayload> {
    const created = await this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
        data: {
          userId: input.userId,
          title: input.title,
          message: input.message,
          type: input.type,
          kind: input.kind ?? 'GENERIC',
          ...(input.data !== undefined ? { data: input.data as Prisma.InputJsonObject } : {}),
        },
      });

      const extraNotifications = await tx.notification.findMany({
        where: { userId: input.userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: MAX_NOTIFICATIONS_PER_USER,
        select: { id: true },
      });

      if (extraNotifications.length > 0) {
        await tx.notification.deleteMany({
          where: {
            id: { in: extraNotifications.map((entry) => entry.id) },
          },
        });
      }

      return notification;
    });

    const payload = this.toPayload(created);
    this.notificationServer.sendToUser(input.userId, payload);
    return payload;
  }

  async markAsRead(userId: number, notificationIdRaw: string): Promise<NotificationPayload> {
    const notificationId = Number(notificationIdRaw);
    if (!Number.isInteger(notificationId)) {
      throw new BadRequestException('Invalid notification id');
    }

    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });

    if (result.count === 0) {
      throw new NotFoundException('Notification not found');
    }

    const updated = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!updated) {
      throw new NotFoundException('Notification not found');
    }

    return this.toPayload(updated);
  }

  async markAllAsRead(userId: number): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
      },
    });

    return result.count;
  }

  private toData(value: Prisma.JsonValue): NotificationData | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as NotificationData)
      : null;
  }

  private toPayload(notification: {
    id: number;
    userId: number;
    title: string;
    message: string;
    type: NotificationType;
    kind: NotificationKind;
    data: Prisma.JsonValue;
    read: boolean;
    createdAt: Date;
  }): NotificationPayload {
    return {
      id: notification.id.toString(),
      userId: notification.userId,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      kind: notification.kind,
      data: this.toData(notification.data),
      read: notification.read,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
