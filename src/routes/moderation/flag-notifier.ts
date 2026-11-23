import { Injectable } from '@nestjs/common';
import { ModerationReason, ModerationTargetType } from '@prisma/client';

import { getOptionalEnv } from '../../config/env';
import { DiscordService } from '../../discord/discord.service';
import { DiscordMessage } from '../../discord/discord.types';

export interface CaseNotice {
  targetType: ModerationTargetType;
  targetId: string;
  reason: ModerationReason;
}

const TARGETS: Record<ModerationTargetType, string> = {
  USER: 'profile',
  PROJECT: 'game',
  COMMENT: 'comment',
};

const REASONS: Record<ModerationReason, string> = {
  SPAM: 'Spam',
  HARASSMENT: 'Harassment',
  HATE: 'Hate',
  SEXUAL_CONTENT: 'Sexual content',
  VIOLENCE: 'Violence',
  ILLEGAL: 'Illegal content',
  IMPERSONATION: 'Impersonation',
  STOLEN_CONTENT: 'Stolen content',
  OTHER: 'Other',
};

/**
 * Tells staff in the Discord channel of `DISCORD_MODERATION_WEBHOOK_URL` that a case opened, silent
 * when unset. A Discord channel is not where personal data belongs: the message names a kind of
 * target, a reason and an id, and never a person or anything a person wrote.
 */
@Injectable()
export class FlagNotifier {
  private readonly webhookUrl = getOptionalEnv('DISCORD_MODERATION_WEBHOOK_URL');
  private readonly adminUrl = getOptionalEnv('ADMIN_PANEL_URL');

  constructor(private readonly discord: DiscordService) {}

  async caseOpened(notice: CaseNotice): Promise<void> {
    if (this.webhookUrl) {
      await this.discord.send(this.webhookUrl, this.message(notice));
    }
  }

  message(notice: CaseNotice): DiscordMessage {
    return {
      username: 'Naucto moderation',
      embeds: [
        {
          title: `A ${TARGETS[notice.targetType]} was reported`,
          color: 0xff8a1f,
          fields: [{ name: 'Reason', value: REASONS[notice.reason], inline: true }],
          footer: { text: `${notice.targetType} #${notice.targetId}` },
          timestamp: new Date().toISOString(),
          ...(this.adminUrl
            ? {
                url: `${this.adminUrl.replace(/\/+$/, '')}/moderation/cases/${
                  notice.targetType
                }/${notice.targetId}`,
              }
            : {}),
        },
      ],
    };
  }
}
