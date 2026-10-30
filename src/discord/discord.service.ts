import { Injectable, Logger } from '@nestjs/common';

import { DiscordEmbed, DiscordMessage } from './discord.types';

/** Discord answers 429 past 30 messages a minute on one webhook; this stays under it. */
export const DISCORD_MESSAGES_PER_MINUTE = 20;

const MINUTE_MS = 60_000;
const TIMEOUT_MS = 5_000;

/** Discord's own caps, past which it refuses the whole message. */
const CONTENT_MAX = 2_000;
const TITLE_MAX = 256;
const DESCRIPTION_MAX = 4_096;
const FIELDS_MAX = 25;
const FIELD_NAME_MAX = 256;
const FIELD_VALUE_MAX = 1_024;
const FOOTER_MAX = 2_048;

/** Text shown as typed in a code block. A backtick inside would close the block. */
export function codeBlock(text: string, max: number = FIELD_VALUE_MAX): string {
  const fence = '```';
  const body = text.replace(/`/g, "'").slice(0, max - fence.length * 2 - 2);
  return `${fence}\n${body}\n${fence}`;
}

function withinLimits(embed: DiscordEmbed): DiscordEmbed {
  return {
    ...embed,
    ...(embed.title ? { title: embed.title.slice(0, TITLE_MAX) } : {}),
    ...(embed.description ? { description: embed.description.slice(0, DESCRIPTION_MAX) } : {}),
    ...(embed.footer ? { footer: { text: embed.footer.text.slice(0, FOOTER_MAX) } } : {}),
    ...(embed.fields
      ? {
          fields: embed.fields.slice(0, FIELDS_MAX).map((field) => ({
            ...field,
            name: field.name.slice(0, FIELD_NAME_MAX),
            value: field.value.slice(0, FIELD_VALUE_MAX),
          })),
        }
      : {}),
  };
}

/**
 * Posts messages to Discord webhooks. A message never mentions anyone, and a failure is logged and
 * never thrown: whatever the message is about must not fail because Discord did.
 */
@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);
  private readonly sentAt = new Map<string, number[]>();

  /** Whether Discord took the message. */
  async send(webhookUrl: string, message: DiscordMessage, now = Date.now()): Promise<boolean> {
    const recent = (this.sentAt.get(webhookUrl) ?? []).filter((at) => now - at < MINUTE_MS);
    if (recent.length >= DISCORD_MESSAGES_PER_MINUTE) {
      this.logger.warn('Skipped a Discord message: the webhook already took its share this minute');
      return false;
    }
    this.sentAt.set(webhookUrl, [...recent, now]);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...message,
          ...(message.content ? { content: message.content.slice(0, CONTENT_MAX) } : {}),
          ...(message.embeds ? { embeds: message.embeds.map(withinLimits) } : {}),
          allowed_mentions: { parse: [] },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Discord refused a message with ${String(response.status)}`);
      }
      return response.ok;
    } catch (error) {
      this.logger.warn(
        `Could not reach Discord: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
