import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@prisma/prisma.service";
import { CreateNotificationInput, NotificationPayload } from "./notifications.types";
import { emitNotificationToUser } from "./notifications.socket";

const MAX_NOTIFICATIONS_PER_USER = 50;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserNotifications(userId: number): Promise<NotificationPayload[]> {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return notifications.map((notification) => this.toPayload(notification));
  }

  async createNotification(input: CreateNotificationInput): Promise<NotificationPayload> {
    const created = await this.prisma.$transaction(async (tx) => {
      const notification = await tx.notification.create({
        data: {
          userId: input.userId,
          title: input.title,
          message: input.message,
          type: input.type,
        },
      });

      const extraNotifications = await tx.notification.findMany({
        where: { userId: input.userId },
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" },
        ],
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
    emitNotificationToUser(input.userId, payload);
    return payload;
  }

  async markAsRead(userId: number, notificationIdRaw: string): Promise<NotificationPayload> {
    const notificationId = Number(notificationIdRaw);
    if (!Number.isInteger(notificationId)) {
      throw new BadRequestException("Invalid notification id");
    }

    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (!notification) {
      throw new NotFoundException("Notification not found");
    }

    if (notification.read) {
      return this.toPayload(notification);
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });

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

  private toPayload(notification: {
    id: number;
    userId: number;
    title: string;
    message: string;
    type: string;
    read: boolean;
    createdAt: Date;
  }): NotificationPayload {
    return {
      id: String(notification.id),
      userId: notification.userId,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      read: notification.read,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
