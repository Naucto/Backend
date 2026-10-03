import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

import {
  PresenceChangedMessage,
  PresenceOfflineMessage,
  PresenceSnapshotMessage,
} from '../../presence/dto/presence-message.dto';
import { PRESENCE_KINDS, PresenceKind } from '../../presence/presence.types';
import {
  EventBasedMessageOf,
  eventBasedMessages,
} from '../../webrtc/server/webrtc.server.event-based';
import { NotificationPayloadDto } from './notification-response.dto';

// Every client message class carries at least one class-validator decorator: validation rejects an
// instance of a class with no validation metadata (forbidUnknownValues, on by default), and a
// rejected message closes the socket.

export class NotificationAuthMessage {
  @ApiProperty({ enum: ['auth'] })
  @IsString()
  type!: 'auth';

  @ApiProperty({ description: 'Access token of the user whose notifications to receive' })
  @IsString()
  token!: string;
}

export class NotificationPingMessage {
  @ApiProperty({ enum: ['ping'] })
  @IsString()
  type!: 'ping';
}

export class PresenceSetMessage {
  @ApiProperty({ enum: ['presence:set'] })
  @IsString()
  type!: 'presence:set';

  @ApiProperty({ enum: PRESENCE_KINDS, enumName: 'PresenceKind' })
  @IsEnum(PRESENCE_KINDS)
  kind!: PresenceKind;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Release being played' })
  @IsOptional()
  @IsInt()
  releaseId?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Project being edited' })
  @IsOptional()
  @IsInt()
  projectId?: number | null;
}

export const NOTIFICATION_CLIENT_MESSAGES = eventBasedMessages({
  auth: NotificationAuthMessage,
  ping: NotificationPingMessage,
  'presence:set': PresenceSetMessage,
});

export class NotificationMessage {
  @ApiProperty({ enum: ['notification'] })
  type!: 'notification';

  @ApiProperty({ type: NotificationPayloadDto })
  payload!: NotificationPayloadDto;
}

export class NotificationsInitMessage {
  @ApiProperty({ enum: ['notifications:init'] })
  type!: 'notifications:init';

  @ApiProperty({
    type: [NotificationPayloadDto],
    description: "The user's notifications, sent once the socket is authenticated",
  })
  payload!: NotificationPayloadDto[];
}

export class NotificationPongMessage {
  @ApiProperty({ enum: ['pong'] })
  type!: 'pong';
}

export const NOTIFICATION_SERVER_MESSAGES = eventBasedMessages({
  notification: NotificationMessage,
  'notifications:init': NotificationsInitMessage,
  pong: NotificationPongMessage,
  'presence:snapshot': PresenceSnapshotMessage,
  'presence:changed': PresenceChangedMessage,
  'presence:offline': PresenceOfflineMessage,
});

export type NotificationServerMessage = EventBasedMessageOf<typeof NOTIFICATION_SERVER_MESSAGES>;
