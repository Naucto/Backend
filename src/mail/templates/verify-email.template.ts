import { RenderedMail } from '../mail.types';
import { MailTranslator } from '../mail-i18n';
import { renderLayout } from './layout';

export interface VerifyEmailParams {
  name: string;
  url: string;
  expiresInHours: number;
}

export function renderVerifyEmail(
  translator: MailTranslator,
  params: VerifyEmailParams,
): RenderedMail {
  const { t } = translator;
  return renderLayout(translator, {
    subject: t('verifyEmail.subject'),
    preheader: t('verifyEmail.preheader'),
    tag: t('verifyEmail.tag'),
    eyebrow: t('verifyEmail.eyebrow'),
    heading: t('verifyEmail.heading'),
    paragraphs: [t('verifyEmail.intro', { name: params.name })],
    action: { label: t('verifyEmail.action'), url: params.url, backup: true },
    notes: [t('verifyEmail.expiry', { hours: params.expiresInHours }), t('verifyEmail.ignore')],
  });
}
