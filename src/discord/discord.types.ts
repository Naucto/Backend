/** The subset of Discord's webhook message this backend sends. */
export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordMessage {
  username?: string;
  content?: string;
  embeds?: DiscordEmbed[];
}
