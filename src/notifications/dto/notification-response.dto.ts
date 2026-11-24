import { ApiProperty } from '@nestjs/swagger';

import { WebRTCOfferDto } from '../../webrtc/webrtc.dto';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_TYPES,
  NotificationData,
  NotificationKind,
  NotificationPayload,
  NotificationType,
} from '../notifications.types';

export class NotificationPayloadDto implements NotificationPayload {
  @ApiProperty({ format: 'uuid', example: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
    description: 'ID of the user notified',
  })
  userId!: string;

  @ApiProperty({ example: 'Build complete' })
  title!: string;

  @ApiProperty({ example: 'Your build is ready.' })
  message!: string;

  @ApiProperty({ enum: NOTIFICATION_TYPES, example: 'INFO' })
  type!: NotificationType;

  @ApiProperty({ enum: NOTIFICATION_KINDS, example: 'GENERIC' })
  kind!: NotificationKind;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    nullable: true,
    description: 'Payload whose shape depends on the kind',
  })
  data!: NotificationData | null;

  @ApiProperty({ example: false })
  read!: boolean;

  @ApiProperty({ example: '2026-06-07T09:00:00.000Z' })
  createdAt!: string;
}

export class NotificationOfferResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 200 })
  statusCode!: number;

  @ApiProperty({ description: 'Response message' })
  message!: string;

  @ApiProperty({ type: WebRTCOfferDto })
  data!: WebRTCOfferDto;
}

export class NotificationResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 200 })
  statusCode!: number;

  @ApiProperty({ description: 'Response message' })
  message!: string;

  @ApiProperty({ type: NotificationPayloadDto })
  data!: NotificationPayloadDto;
}

export class NotificationsReadCountDto {
  @ApiProperty({ example: 3, description: 'Notifications that were unread' })
  count!: number;
}

export class NotificationsReadAllResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 200 })
  statusCode!: number;

  @ApiProperty({ description: 'Response message' })
  message!: string;

  @ApiProperty({ type: NotificationsReadCountDto })
  data!: NotificationsReadCountDto;
}
