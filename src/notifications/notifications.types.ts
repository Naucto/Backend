export type NotificationPayload = {
  id: string;
  userId: number;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
};

export type CreateNotificationInput = {
  userId: number;
  title: string;
  message: string;
  type: string;
};
