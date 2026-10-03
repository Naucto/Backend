import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsInt, IsOptional, IsString } from 'class-validator';

import { EventBasedMessageOf, eventBasedMessages } from './webrtc.server.event-based';

// Wire messages of the synced game-table protocol. `data` is opaque: relayed, never inspected.
//
// Every client message class carries at least one class-validator decorator: validation rejects an
// instance of a class with no validation metadata (forbidUnknownValues, on by default), and a
// rejected message closes the socket.

// Any JSON value: the reflected type of an `unknown` field is `Object`, and only a schema
// combinator keeps it from being documented as an object.
const OPAQUE_DATA = { description: 'Game payload, relayed as is', oneOf: [{}] };

export class GameTableStateMessage {
  @ApiProperty({ enum: ['state'] })
  @IsString()
  type!: 'state';

  @ApiPropertyOptional(OPAQUE_DATA)
  @Allow()
  data?: unknown;
}

export class GameTableRequestMessage {
  @ApiProperty({ enum: ['request'] })
  @IsString()
  type!: 'request';

  @ApiPropertyOptional(OPAQUE_DATA)
  @Allow()
  data?: unknown;
}

export class GameTableResponseMessage {
  @ApiProperty({ enum: ['response'] })
  @IsString()
  type!: 'response';

  @ApiProperty({ description: 'userId of the slave this response is addressed to' })
  @IsInt()
  to!: number;

  @ApiPropertyOptional(OPAQUE_DATA)
  @Allow()
  data?: unknown;
}

export class GameTableSignalMessage {
  @ApiProperty({ enum: ['signal'] })
  @IsString()
  type!: 'signal';

  @ApiPropertyOptional({
    description: 'userId of the slave the host addresses; absent from a slave to its host',
  })
  @IsOptional()
  @IsInt()
  to?: number;

  @ApiPropertyOptional(OPAQUE_DATA)
  @Allow()
  data?: unknown;
}

export const GAME_TABLE_CLIENT_MESSAGES = eventBasedMessages({
  state: GameTableStateMessage,
  request: GameTableRequestMessage,
  response: GameTableResponseMessage,
  signal: GameTableSignalMessage,
});

export class GameTableStateBroadcast {
  @ApiProperty({ enum: ['state'] })
  type!: 'state';

  @ApiPropertyOptional(OPAQUE_DATA)
  data?: unknown;
}

export class GameTableRequestRelay {
  @ApiProperty({ enum: ['request'] })
  type!: 'request';

  @ApiProperty({ description: 'userId of the slave that sent the request' })
  from!: number;

  @ApiPropertyOptional(OPAQUE_DATA)
  data?: unknown;
}

export class GameTableResponseRelay {
  @ApiProperty({ enum: ['response'] })
  type!: 'response';

  @ApiPropertyOptional(OPAQUE_DATA)
  data?: unknown;
}

export class GameTableSignalRelay {
  @ApiProperty({ enum: ['signal'] })
  type!: 'signal';

  @ApiPropertyOptional({
    description: 'userId of the slave that sent the signal; absent from the host to a slave',
  })
  from?: number;

  @ApiPropertyOptional(OPAQUE_DATA)
  data?: unknown;
}

export class GameTablePeerJoinedMessage {
  @ApiProperty({ enum: ['peer-joined'] })
  type!: 'peer-joined';

  @ApiProperty({ description: 'userId of the slave now at the table' })
  userId!: number;
}

export class GameTablePeerLeftMessage {
  @ApiProperty({ enum: ['peer-left'] })
  type!: 'peer-left';

  @ApiProperty({ description: 'userId of the slave that left the table' })
  userId!: number;
}

export class GameTableSessionEndedMessage {
  @ApiProperty({ enum: ['session-ended'] })
  type!: 'session-ended';
}

export const GAME_TABLE_SERVER_MESSAGES = eventBasedMessages({
  state: GameTableStateBroadcast,
  request: GameTableRequestRelay,
  response: GameTableResponseRelay,
  signal: GameTableSignalRelay,
  'peer-joined': GameTablePeerJoinedMessage,
  'peer-left': GameTablePeerLeftMessage,
  'session-ended': GameTableSessionEndedMessage,
});

export type GameTableServerMessage = EventBasedMessageOf<typeof GAME_TABLE_SERVER_MESSAGES>;
