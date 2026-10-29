import { RenderedMail } from '../mail.types';
import { MailTranslator } from '../mail-i18n';
import { renderLayout } from './layout';

export interface ResetPasswordParams {
  name: string;
  url: string;
  expiresInMinutes: number;
}

export function renderResetPassword(
  translator: MailTranslator,
  params: ResetPasswordParams,
): RenderedMail {
  const { t } = translator;
  return renderLayout(translator, {
    subject: t('resetPassword.subject'),
    preheader: t('resetPassword.preheader'),
    tag: t('resetPassword.tag'),
    eyebrow: t('resetPassword.eyebrow'),
    heading: t('resetPassword.heading'),
    paragraphs: [t('resetPassword.intro', { name: params.name })],
    action: { label: t('resetPassword.action'), url: params.url, backup: true },
    notes: [
      t('resetPassword.expiry', { minutes: params.expiresInMinutes }),
      t('resetPassword.ignore'),
    ],
  });
}
