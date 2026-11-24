import { ModerationReason, ModerationTargetType } from '@prisma/client';

import { withEnv } from '../../../test/env';
import { uuidOf } from '../../../test/uuid';
import { DiscordService } from '../../discord/discord.service';
import { FlagNotifier } from './flag-notifier';

const NOTICE = {
  targetType: ModerationTargetType.COMMENT,
  targetId: uuidOf(31),
  reason: ModerationReason.HARASSMENT,
};

describe('FlagNotifier', () => {
  const discord = { send: jest.fn() };
  const notifier = (): FlagNotifier => new FlagNotifier(discord as unknown as DiscordService);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('stays silent when no webhook is set', async () => {
    withEnv({});

    await notifier().caseOpened(NOTICE);

    expect(discord.send).not.toHaveBeenCalled();
  });

  it('posts to the webhook, linking the case in the admin console', async () => {
    withEnv({
      DISCORD_MODERATION_WEBHOOK_URL: 'https://discord.test/hook',
      ADMIN_PANEL_URL: 'https://admin.naucto.test/',
    });

    await notifier().caseOpened(NOTICE);

    expect(discord.send).toHaveBeenCalledWith(
      'https://discord.test/hook',
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: 'A comment was reported',
            url: `https://admin.naucto.test/moderation/cases/COMMENT/${uuidOf(31)}`,
          }),
        ],
      }),
    );
  });

  it.each([
    [ModerationTargetType.USER, 'A profile was reported'],
    [ModerationTargetType.PROJECT, 'A game was reported'],
    [ModerationTargetType.COMMENT, 'A comment was reported'],
    [ModerationTargetType.COLLECTION, 'A collection was reported'],
  ])('names a %s by its kind and links its case', (targetType, title) => {
    withEnv({ ADMIN_PANEL_URL: 'https://admin.naucto.test' });

    const [embed] = notifier().message({ ...NOTICE, targetType }).embeds ?? [];

    expect(embed).toMatchObject({
      title,
      url: `https://admin.naucto.test/moderation/cases/${targetType}/${uuidOf(31)}`,
    });
  });

  // A notice is built from a kind, a reason and an id, so nothing a person wrote can reach it. This
  // pins the shape: a field added to the notice has to be argued for here.
  it('carries a kind of target, a reason and an id, and nothing else', () => {
    withEnv({});

    const [embed] = notifier().message(NOTICE).embeds ?? [];

    expect(embed).toEqual({
      title: 'A comment was reported',
      color: expect.any(Number),
      fields: [{ name: 'Reason', value: 'Harassment', inline: true }],
      footer: { text: `COMMENT #${uuidOf(31)}` },
      timestamp: expect.any(String),
    });
  });
});
