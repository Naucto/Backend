export const NOTIFICATION_TYPES = ['INFO', 'WARNING'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_KINDS = [
  'GENERIC',
  'FRIEND_REQUEST',
  'FRIEND_ACCEPTED',
  'FEATURED',
  'COLLABORATOR_ADDED',
  'COLLABORATOR_REMOVED',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** JSON payload whose shape depends on the notification's kind. */
export type NotificationData = Record<string, unknown>;

export type NotificationPayload = {
  id: string;
  userId: number;
  title: string;
  message: string;
  type: NotificationType;
  kind: NotificationKind;
  data: NotificationData | null;
  read: boolean;
  createdAt: string;
};

export type CreateNotificationInput = {
  userId: number;
  title: string;
  message: string;
  type: NotificationType;
  kind?: NotificationKind;
  data?: NotificationData;
};
