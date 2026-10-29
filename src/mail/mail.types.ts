/**
 * Languages a mail can be written in. Adding one is adding its folder under `src/i18n/` (with the
 * same keys as `en`, which `npm run check:i18n` verifies) and its code here; templates hold no text.
 */
export const MAIL_LOCALES = ['en'] as const;

export type MailLocale = (typeof MAIL_LOCALES)[number];

// TODO(NCTO-263): pick the recipient's language once accounts store one; every mail is English now.
export const DEFAULT_MAIL_LOCALE: MailLocale = 'en';

/** What a template produces: the same message as HTML and as plain text, for clients without HTML. */
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export interface MailMessage extends RenderedMail {
  to: string;
}
