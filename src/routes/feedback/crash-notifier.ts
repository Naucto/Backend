import { Injectable, Logger } from '@nestjs/common';
import { CrashSource } from '@prisma/client';

import { getOptionalEnv } from '../../config/env';

export type CrashNoticeKind = 'new' | 'regressed' | 'milestone';

export interface CrashNotice {
  kind: CrashNoticeKind;
  groupId: number;
  source: CrashSource;
  name: string;
  message: string;
  stack: string;
  route: string;
  count: number;
  appRelease: string | null;
}

/** The counts at which a group that keeps happening is announced again. */
export const CRASH_MILESTONES: ReadonlySet<number> = new Set([10, 100, 1000, 10000]);

/** Discord answers 429 past 30 messages a minute on one webhook; this stays under it. */
export const CRASH_NOTICES_PER_MINUTE = 20;

const WEBHOOK_TIMEOUT_MS = 5000;
const STACK_LINES = 6;

/** Discord's own caps on an embed. */
const TITLE_MAX = 256;
const DESCRIPTION_MAX = 4096;
const FIELD_MAX = 1024;

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

/** Text Discord shows as typed: a backtick would close the code block it sits in. */
function codeBlock(text: string, max: number): string {
  const fence = '```';
  const body = text.replace(/`/g, "'").slice(0, max - fence.length * 2 - 2);
  return `${fence}\n${body}\n${fence}`;
}

/**
 * Announces crashes in a Discord channel through `DISCORD_CRASH_WEBHOOK_URL`. Silent when it is
 * unset, and never throws: a crash report must not fail because Discord did.
 */
@Injectable()
export class CrashNotifier {
  private readonly logger = new Logger(CrashNotifier.name);
  private readonly webhookUrl = getOptionalEnv('DISCORD_CRASH_WEBHOOK_URL');
  private readonly adminUrl = getOptionalEnv('ADMIN_PANEL_URL');
  private sentAt: number[] = [];

  async notify(notice: CrashNotice, now = Date.now()): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }
    this.sentAt = this.sentAt.filter((at) => now - at < 60_000);
    if (this.sentAt.length >= CRASH_NOTICES_PER_MINUTE) {
      this.logger.warn(`Skipped the Discord notice of crash group ${String(notice.groupId)}`);
      return;
    }
    this.sentAt.push(now);

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.payload(notice)),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Discord refused a crash notice with ${String(response.status)}`);
      }
    } catch (error) {
      this.logger.warn(
        `Could not reach Discord: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  payload(notice: CrashNotice): Record<string, unknown> {
    const stack = notice.stack.split('\n').slice(0, STACK_LINES).join('\n');
    const fields = [
      { name: 'Source', value: SOURCES[notice.source], inline: true },
      { name: 'Occurrences', value: String(notice.count), inline: true },
      { name: 'Release', value: notice.appRelease ?? 'unknown', inline: true },
      { name: 'Route', value: codeBlock(notice.route || '/', FIELD_MAX), inline: false },
      ...(stack ? [{ name: 'Stack', value: codeBlock(stack, FIELD_MAX), inline: false }] : []),
    ];
    return {
      username: 'Naucto crashes',
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `${HEADLINES[notice.kind]}: ${notice.name}`.slice(0, TITLE_MAX),
          description: codeBlock(notice.message || notice.name, DESCRIPTION_MAX),
          color: COLOURS[notice.kind],
          fields,
          footer: { text: `Crash group #${String(notice.groupId)}` },
          timestamp: new Date().toISOString(),
          ...(this.adminUrl ? { url: `${this.adminUrl.replace(/\/+$/, '')}/crashes` } : {}),
        },
      ],
    };
  }
}
