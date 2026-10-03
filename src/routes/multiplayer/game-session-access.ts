import { GameSessionVisibility } from '@prisma/client';

/** Who, outside a session, it is open to. */
export type SessionAudience = 'everyone' | 'host-friends' | 'code-holders';

/** Every visibility names its audience, so a new one cannot be added without deciding who it admits. */
export const SESSION_AUDIENCE: Record<GameSessionVisibility, SessionAudience> = {
  [GameSessionVisibility.PUBLIC]: 'everyone',
  [GameSessionVisibility.FRIENDS_ONLY]: 'host-friends',
  [GameSessionVisibility.INVITE_CODE]: 'code-holders',
};

/**
 * Whether a session is listed to a viewer. A code-only session never is, not even to its members: it
 * is reached by its code. Fetching one by id is also open to its members, whatever its audience.
 */
export function isListedTo(
  visibility: GameSessionVisibility,
  viewer: { isMember: boolean; isHostFriend: boolean },
): boolean {
  switch (SESSION_AUDIENCE[visibility]) {
    case 'everyone':
      return true;
    case 'host-friends':
      return viewer.isMember || viewer.isHostFriend;
    case 'code-holders':
      return false;
  }
}

/** Whether someone outside the session may take a seat in it. */
export function canJoin(
  visibility: GameSessionVisibility,
  joiner: { isHostFriend: boolean; holdsCode: boolean },
): boolean {
  switch (SESSION_AUDIENCE[visibility]) {
    case 'everyone':
      return true;
    case 'host-friends':
      return joiner.isHostFriend;
    case 'code-holders':
      return joiner.holdsCode;
  }
}
