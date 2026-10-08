export type SyncedGameTableRole = 'host' | 'slave';

/** The seat a connection ticket admits to a game table. */
export interface SyncedGameTableTicket {
  sessionId: string;
  userId: number;
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
    typeof claims.userId === 'number' &&
    typeof claims.maxPlayers === 'number' &&
    (claims.role === 'host' || claims.role === 'slave')
  );
}

/** Seats left to players other than the host, who holds one of the `maxPlayers`. */
export function seatsForGuests(maxPlayers: number): number {
  return maxPlayers - 1;
}
