import { Allow, IsInt, IsOptional, IsString } from "class-validator";

// Wire-message DTOs for the synced game-table protocol, validated per-frame by
// @EventBasedMessage. `data` is intentionally opaque — never inspected
// server-side — but must be decorated with @Allow() so it survives validation
// and is not treated as an unexpected property.
//
// Every message class MUST carry at least one class-validator decorator:
// class-validator's forbidUnknownValues (on by default) rejects any object whose
// class has no registered validation metadata with "an unknown value was passed
// to the validate function", which the pipeline treats as an invalid message and
// closes the socket. A bare `type!: string` with no decorator is such a class —
// so `@IsString() type` is load-bearing here, not cosmetic.

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
