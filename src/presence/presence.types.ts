export const PRESENCE_KINDS = ['IDLE', 'PLAYING', 'BUILDING', 'HOSTING'] as const;
export type PresenceKind = (typeof PRESENCE_KINDS)[number];

// The kinds a client may declare; the others are derived server-side from live sessions.
export const CLIENT_PRESENCE_KINDS = ['IDLE', 'PLAYING'] as const;

export type PresenceSetInput = {
  kind: PresenceKind;
  releaseId?: string | null;
  projectId?: string | null;
};

export type PresenceState = {
  userId: string;
  // Identity, so a presence row can name someone without a second lookup.
  username: string;
  nickname: string | null;
  kind: PresenceKind;
  releaseId: string | null;
  projectId: string | null;
  sessionId: string | null;
  title: string | null;
  // Cover of the game being played, built or hosted.
  coverUrl: string | null;
  players: number | null;
  maxPlayers: number | null;
  joinable: boolean;
  since: string;
};

// Contract the notifications websocket server uses to drive presence without
// depending on the presence module (which depends on notifications).
export interface PresenceSocketHandler {
  onSocketOpen(userId: string, connectionId: number): Promise<PresenceState[]>;
  onSocketClose(userId: string, connectionId: number): Promise<void>;
  onSet(userId: string, connectionId: number, input: PresenceSetInput): Promise<void>;
}
