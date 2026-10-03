import { ApiProperty } from '@nestjs/swagger';

import { PresenceDto } from './presence.dto';

export class PresenceSnapshotMessage {
  @ApiProperty({ enum: ['presence:snapshot'] })
  type!: 'presence:snapshot';

  @ApiProperty({ type: [PresenceDto], description: "The online friends' presence" })
  payload!: PresenceDto[];
}

export class PresenceChangedMessage {
  @ApiProperty({ enum: ['presence:changed'] })
  type!: 'presence:changed';

  @ApiProperty({ type: PresenceDto })
  payload!: PresenceDto;
}

export class PresenceOfflinePayloadDto {
  @ApiProperty({ example: 1 })
  userId!: number;
}

export class PresenceOfflineMessage {
  @ApiProperty({ enum: ['presence:offline'] })
  type!: 'presence:offline';

  @ApiProperty({ type: PresenceOfflinePayloadDto })
  payload!: PresenceOfflinePayloadDto;
}

export type PresenceServerMessage =
  | PresenceSnapshotMessage
  | PresenceChangedMessage
  | PresenceOfflineMessage;
