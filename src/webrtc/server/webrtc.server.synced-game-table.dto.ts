import { IsInt, IsOptional } from "class-validator";

// Wire-message DTOs for the synced game-table protocol, validated per-frame by
// @EventBasedMessage. `data` is intentionally opaque — never inspected server-side.

export class GameTableStateMessage {
  type!: string;
  data?: unknown;
}

export class GameTableRequestMessage {
  type!: string;
  data?: unknown;
}

export class GameTableResponseMessage {
  type!: string;

  // userId of the slave this response is addressed to.
  @IsInt()
  to!: number;

  data?: unknown;
}

export class GameTableSignalMessage {
  type!: string;

  // Present only when the host targets a specific slave; absent for slave -> host.
  @IsOptional()
  @IsInt()
  to?: number;

  data?: unknown;
}
