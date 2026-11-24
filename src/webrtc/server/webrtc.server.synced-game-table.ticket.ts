import { isUUID } from 'class-validator';

export type SyncedGameTableRole = 'host' | 'slave';

/** The seat a connection ticket admits to a game table. */
export interface SyncedGameTableTicket {
  sessionId: string;
  /**
   * The number the seat plays under: what its game reads as `net.id()` and what the table addresses
   * it by. An integer, because published games compute on it.
   */
  playerNumber: number;
  /** The account sitting there, or null for an editor self-join, which has none. */
  userId: string | null;
  role: SyncedGameTableRole;
  maxPlayers: number;
}

/**
 * Tells a ticket apart from the other tokens signed with the same secret, such as access tokens.
 */
export const SYNCED_GAME_TABLE_TICKET_KIND = 'game-table';

/** What a signed ticket carries. */
export type SyncedGameTableTicketPayload = SyncedGameTableTicket & {
  kind: typeof SYNCED_GAME_TABLE_TICKET_KIND;
};

export function isSyncedGameTableTicketPayload(
  payload: unknown,
): payload is SyncedGameTableTicketPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }

  const claims = payload as Partial<Record<keyof SyncedGameTableTicketPayload, unknown>>;

  return (
    claims.kind === SYNCED_GAME_TABLE_TICKET_KIND &&
    typeof claims.sessionId === 'string' &&
    Number.isInteger(claims.playerNumber) &&
    (claims.userId === null || isUUID(claims.userId)) &&
    typeof claims.maxPlayers === 'number' &&
    (claims.role === 'host' || claims.role === 'slave')
  );
}

/** Seats left to players other than the host, who holds one of the `maxPlayers`. */
export function seatsForGuests(maxPlayers: number): number {
  return maxPlayers - 1;
}
