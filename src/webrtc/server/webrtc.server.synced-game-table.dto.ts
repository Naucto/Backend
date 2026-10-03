import { Allow, IsInt, IsOptional, IsString } from "class-validator";

// Wire messages of the synced game-table protocol. `data` is opaque: relayed, never inspected.
//
// Every class carries at least one class-validator decorator: validation rejects an instance of a
// class with no validation metadata (forbidUnknownValues, on by default), and a rejected message
// closes the socket.

export class GameTableStateMessage {
  @IsString()
    type!: string;

  @Allow()
    data?: unknown;
}

export class GameTableRequestMessage {
  @IsString()
    type!: string;

  @Allow()
    data?: unknown;
}

export class GameTableResponseMessage {
  @IsString()
    type!: string;

  // userId of the slave this response is addressed to.
  @IsInt()
    to!: number;

  @Allow()
    data?: unknown;
}

export class GameTableSignalMessage {
  @IsString()
    type!: string;

  // Present only when the host targets a specific slave; absent for slave -> host.
  @IsOptional()
  @IsInt()
    to?: number;

  @Allow()
    data?: unknown;
}
