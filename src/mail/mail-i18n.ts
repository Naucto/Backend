import { I18nOptions, PathValue } from 'nestjs-i18n';
import { join } from 'path';

import { I18nPath, I18nTranslations } from '../i18n/i18n.generated';
import { DEFAULT_MAIL_LOCALE, MailLocale } from './mail.types';

/**
 * How mail text is looked up: one folder per language under `src/i18n/`, copied next to the
 * compiled code by the build. A key another language lacks falls back to English, and
 * `npm run check:i18n` lists it.
 */
export const MAIL_I18N_OPTIONS: I18nOptions = {
  fallbackLanguage: DEFAULT_MAIL_LOCALE,
  loaderOptions: { path: join(__dirname, '..', 'i18n'), watch: false },
  // Mails name their language themselves; nothing is read from the request that triggers them.
  disableMiddleware: true,
};

type MailFile = I18nTranslations['mail'];

/**
 * A path of `mail.json` without the file's own name, kept only when it leads to a text rather
 * than to a group of them. Written to spread over every path.
 */
type TextIn<P> = P extends `mail.${infer Key}`
  ? PathValue<MailFile, Key> extends string
    ? Key
    : never
  : never;

/** Keys of `src/i18n/<locale>/mail.json`, as the templates name them. */
export type MailKey = TextIn<I18nPath>;

/** One language's text, as the templates read it. */
export interface MailTranslator {
  locale: MailLocale;
  t(key: MailKey, args?: Record<string, string | number>): string;
}
