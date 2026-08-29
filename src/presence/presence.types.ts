export const PRESENCE_KINDS = ["IDLE", "PLAYING", "BUILDING", "HOSTING"] as const;
export type PresenceKind = (typeof PRESENCE_KINDS)[number];

// Only these can be declared by the client; HOSTING / BUILDING are derived
// server-side from live game / work sessions.
export const CLIENT_PRESENCE_KINDS = ["IDLE", "PLAYING"] as const;

export type PresenceSetInput = {
  kind: PresenceKind;
  releaseId?: number | null;
  projectId?: number | null;
  sessionId?: string | null;
};

export type PresenceState = {
  userId: number;
  // Identity, so a presence row can name someone without a second lookup.
  username: string;
  nickname: string | null;
  kind: PresenceKind;
  releaseId: number | null;
  projectId: number | null;
  sessionId: string | null;
  title: string | null;
  // Cover of the game being played, built or hosted.
  coverUrl: string | null;
  players: number | null;
  maxPlayers: number | null;
  joinable: boolean;
  since: string;
};

// Messages pushed over the notifications websocket.
export type PresenceServerMessage =
  | { type: "presence:snapshot"; payload: PresenceState[] }
  | { type: "presence:changed"; payload: PresenceState }
  | { type: "presence:offline"; payload: { userId: number } };

// Contract the notifications websocket server uses to drive presence without
// depending on the presence module (which depends on notifications).
export interface PresenceSocketHandler {
  onSocketOpen(userId: number): Promise<PresenceState[]>;
  onSocketClose(userId: number): Promise<void>;
  onSet(userId: number, input: PresenceSetInput): Promise<void>;
}
