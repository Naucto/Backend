export const NOTIFICATION_TYPES = ["INFO", "WARNING"] as const;

export type NotificationType = typeof NOTIFICATION_TYPES[number];

export type NotificationPayload = {
  id: string;
  userId: number;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  createdAt: string;
};

export type CreateNotificationInput = {
  userId: number;
  title: string;
  message: string;
  type: NotificationType;
};
