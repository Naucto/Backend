/**
 * Gives the notification bell of the seeded people something to show: one notification of each
 * kind a client can open or read, some read and some not, spread over the last few days. Each
 * `data` has the shape the service that writes the kind gives it (friends, recommendations,
 * projects, moderation), with the ids of rows that exist: the pending requests of the social
 * graph, the seeded games, a warning recorded in the moderation history. A notification about a
 * collaboration also makes the person a collaborator, as the real route would have.
 *
 * Every notification has an id of its own, so a re-run refreshes its text and its date and leaves
 * what the person has read alone, and writes nothing twice. Run by `seed:dev`, or alone with
 * `seed:dev -- --only notifications`.
 */
import { NotificationKind, Prisma, PrismaClient } from '@prisma/client';

import { keepEditTime } from '../src/routes/project/keep-edit-time';

const HOUR_MS = 3_600_000;

/** The id a seeded notification keeps from one run to the next. */
const seedNotificationId = (index: number): string =>
  `a0710f1c-5eed-4000-8000-${index.toString(16).padStart(12, '0')}`;

/** The warning marie finds in her standing, and her MODERATION notification points at. */
const WARNING_ACTION_ID = 'a0710f1c-5eed-4000-8000-0000000000ff';

interface GameRef {
  owner: string;
  name: string;
}

/** A notification as the seed describes it; the data is built once the rows it names are known. */
interface SeedNotification {
  to: string;
  hoursAgo: number;
  read: boolean;
  title: string;
  message: string;
  type: 'INFO' | 'WARNING';
  kind: NotificationKind;
  /** What the client opens: a pending request, a game, the warning on file. */
  about?:
    | { request: string }
    | { accepter: string }
    | { game: GameRef; collaborator?: string }
    | { warning: string };
}

/** The place in this list is what identifies a seeded notification: add at the end. */
const NOTIFICATIONS: SeedNotification[] = [
  {
    to: 'alexis',
    hoursAgo: 2,
    read: false,
    title: 'New friend request',
    message: 'julien wants to be your friend',
    type: 'INFO',
    kind: 'FRIEND_REQUEST',
    about: { request: 'julien' },
  },
  {
    to: 'alexis',
    hoursAgo: 30,
    read: false,
    title: 'New friend request',
    message: 'kenza wants to be your friend',
    type: 'INFO',
    kind: 'FRIEND_REQUEST',
    about: { request: 'kenza' },
  },
  {
    to: 'alexis',
    hoursAgo: 52,
    read: true,
    title: 'Friend request accepted',
    message: 'louis accepted your friend request',
    type: 'INFO',
    kind: 'FRIEND_ACCEPTED',
    about: { accepter: 'louis' },
  },
  {
    to: 'alexis',
    hoursAgo: 20,
    read: false,
    title: 'Your game is featured!',
    message: 'Platformer Tutorial is the game of the week on the Naucto hub.',
    type: 'INFO',
    kind: 'FEATURED',
    about: { game: { owner: 'alexis', name: 'Platformer Tutorial' } },
  },
  {
    to: 'alexis',
    hoursAgo: 96,
    read: true,
    title: 'Duel',
    message: 'louis added you to Duel',
    type: 'INFO',
    kind: 'COLLABORATOR_ADDED',
    about: { game: { owner: 'louis', name: 'Duel' }, collaborator: 'alexis' },
  },
  {
    to: 'alexis',
    hoursAgo: 8,
    read: false,
    title: 'Scheduled maintenance',
    message: 'The servers restart tomorrow at 06:00 UTC for a few minutes.',
    type: 'WARNING',
    kind: 'GENERIC',
  },
  {
    to: 'julien',
    hoursAgo: 5,
    read: false,
    title: 'Your First Game',
    message: 'alexis added you to Your First Game',
    type: 'INFO',
    kind: 'COLLABORATOR_ADDED',
    about: { game: { owner: 'alexis', name: 'Your First Game' }, collaborator: 'julien' },
  },
  {
    to: 'julien',
    hoursAgo: 70,
    read: true,
    title: 'Platformer Tutorial',
    message: 'alexis removed you from Platformer Tutorial',
    type: 'INFO',
    kind: 'COLLABORATOR_REMOVED',
  },
  {
    to: 'julien',
    hoursAgo: 120,
    read: true,
    title: 'Welcome to Naucto',
    message: 'Make your first game from the editor, it takes five minutes.',
    type: 'INFO',
    kind: 'GENERIC',
  },
  {
    to: 'marie',
    hoursAgo: 4,
    read: false,
    title: 'You received a warning',
    message: 'Please keep the hub free of promotional links.',
    type: 'WARNING',
    kind: 'MODERATION',
    about: { warning: 'marie' },
  },
  {
    to: 'marie',
    hoursAgo: 26,
    read: false,
    title: 'Friend request accepted',
    message: 'alexis accepted your friend request',
    type: 'INFO',
    kind: 'FRIEND_ACCEPTED',
    about: { accepter: 'alexis' },
  },
  {
    to: 'louis',
    hoursAgo: 44,
    read: false,
    title: 'Your game is featured!',
    message: 'Duel is the game of the week on the Naucto hub.',
    type: 'INFO',
    kind: 'FEATURED',
    about: { game: { owner: 'louis', name: 'Duel' } },
  },
  {
    to: 'louis',
    hoursAgo: 75,
    read: true,
    title: 'Moon Lander',
    message: 'thea added you to Moon Lander',
    type: 'INFO',
    kind: 'COLLABORATOR_ADDED',
    about: { game: { owner: 'thea', name: 'Moon Lander' }, collaborator: 'louis' },
  },
];

/** Writes the notifications and answers what it wrote, in one line. */
export async function seedNotifications(
  prisma: PrismaClient,
  people: Map<string, string>,
): Promise<string> {
  const personId = (username: string): string => {
    const id = people.get(username);
    if (id === undefined) {
      throw new Error(`${username} missing from the seeded users`);
    }
    return id;
  };

  const requests = await prisma.friendRequest.findMany({
    where: { toId: personId('alexis') },
    select: { id: true, fromId: true },
  });
  const games = await prisma.project.findMany({
    select: { id: true, name: true, userId: true, updatedAt: true },
  });

  // The warning is a row of the moderation history: its id is what the standing page lists.
  await prisma.moderationAction.upsert({
    where: { id: WARNING_ACTION_ID },
    update: {},
    create: {
      id: WARNING_ACTION_ID,
      action: 'ACCOUNT_WARNED',
      actorId: personId('alexis'),
      targetType: 'USER',
      targetId: personId('marie'),
      subjectUserId: personId('marie'),
      reason: 'SPAM',
      publicMessage: 'Please keep the hub free of promotional links.',
      visibleToSubject: true,
    },
  });

  let written = 0;
  let skipped = 0;
  for (const [index, notification] of NOTIFICATIONS.entries()) {
    let data: Prisma.InputJsonObject | undefined;
    const about = notification.about;
    if (about !== undefined && 'request' in about) {
      const fromId = personId(about.request);
      const request = requests.find((row) => row.fromId === fromId);
      if (request === undefined) {
        skipped++;
        continue;
      }
      data = { requestId: request.id, fromUserId: fromId };
    } else if (about !== undefined && 'accepter' in about) {
      data = { userId: personId(about.accepter) };
    } else if (about !== undefined && 'warning' in about) {
      data = { actionId: WARNING_ACTION_ID, action: 'ACCOUNT_WARNED' };
    } else if (about !== undefined) {
      const ownerId = personId(about.game.owner);
      const game = games.find((row) => row.userId === ownerId && row.name === about.game.name);
      if (game === undefined) {
        skipped++;
        continue;
      }
      data = { projectId: game.id };
      if (about.collaborator !== undefined) {
        const collaboratorId = personId(about.collaborator);
        await prisma.project.update({
          where: { id: game.id },
          data: { collaborators: { connect: { id: collaboratorId } }, ...keepEditTime(game) },
        });
      }
    }

    const row = {
      userId: personId(notification.to),
      title: notification.title,
      message: notification.message,
      type: notification.type,
      kind: notification.kind,
      data: data ?? Prisma.DbNull,
      createdAt: new Date(Date.now() - notification.hoursAgo * HOUR_MS),
    };
    const id = seedNotificationId(index);
    // `read` is left out of the update: a re-run must not make unread what the person opened.
    await prisma.notification.upsert({
      where: { id },
      update: row,
      create: { id, ...row, read: notification.read },
    });
    written++;
  }

  const note = skipped > 0 ? `, ${String(skipped)} skipped for want of a game or a request` : '';
  return `${String(written)} notifications${note}`;
}
