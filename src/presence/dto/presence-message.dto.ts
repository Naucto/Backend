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
  @ApiProperty({ format: 'uuid', example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b' })
  userId!: string;
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
