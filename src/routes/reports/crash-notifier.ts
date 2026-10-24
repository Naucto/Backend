import { Injectable } from '@nestjs/common';
import { CrashSource } from '@prisma/client';

import { getOptionalEnv } from '../../config/env';
import { codeBlock, DiscordService } from '../../discord/discord.service';
import { DiscordMessage } from '../../discord/discord.types';

export type CrashNoticeKind = 'new' | 'regressed' | 'milestone';

export interface CrashNotice {
  kind: CrashNoticeKind;
  reportId: number;
  source: CrashSource;
  name: string;
  message: string;
  stack: string;
  route: string;
  count: number;
  appRelease: string | null;
}

/** The counts at which a crash that keeps happening is announced again. */
export const CRASH_MILESTONES: ReadonlySet<number> = new Set([10, 100, 1000, 10000]);

const STACK_LINES = 6;

const HEADLINES: Record<CrashNoticeKind, string> = {
  new: 'New crash',
  regressed: 'Crash is back after being resolved',
  milestone: 'Crash keeps happening',
};

const COLOURS: Record<CrashNoticeKind, number> = {
  new: 0xff3d7f,
  regressed: 0xff8a1f,
  milestone: 0xffcc33,
};

const SOURCES: Record<CrashSource, string> = {
  WEB: 'Web app',
  ENGINE: 'Engine',
  BACKEND: 'Backend',
};

/** Announces crashes in the Discord channel of `DISCORD_CRASH_WEBHOOK_URL`, silent when unset. */
@Injectable()
export class CrashNotifier {
  private readonly webhookUrl = getOptionalEnv('DISCORD_CRASH_WEBHOOK_URL');
  private readonly adminUrl = getOptionalEnv('ADMIN_PANEL_URL');

  constructor(private readonly discord: DiscordService) {}

  async notify(notice: CrashNotice): Promise<void> {
    if (this.webhookUrl) {
      await this.discord.send(this.webhookUrl, this.message(notice));
    }
  }

  message(notice: CrashNotice): DiscordMessage {
    const stack = notice.stack.split('\n').slice(0, STACK_LINES).join('\n');
    return {
      username: 'Naucto crashes',
      embeds: [
        {
          title: `${HEADLINES[notice.kind]}: ${notice.name}`,
          description: codeBlock(notice.message || notice.name, 4_096),
          color: COLOURS[notice.kind],
          fields: [
            { name: 'Source', value: SOURCES[notice.source], inline: true },
            { name: 'Occurrences', value: String(notice.count), inline: true },
            { name: 'Release', value: notice.appRelease ?? 'unknown', inline: true },
            { name: 'Route', value: codeBlock(notice.route || '/') },
            ...(stack ? [{ name: 'Stack', value: codeBlock(stack) }] : []),
          ],
          footer: { text: `Report #${String(notice.reportId)}` },
          timestamp: new Date().toISOString(),
          ...(this.adminUrl ? { url: `${this.adminUrl.replace(/\/+$/, '')}/crashes` } : {}),
        },
      ],
    };
  }
}
