import { RenderedMail } from '../mail.types';
import { MailTranslator } from '../mail-i18n';
import { renderLayout } from './layout';

export interface NotificationMailParams {
  name: string;
  title: string;
  message: string;
  url: string;
}

/**
 * An in-app notification sent again by mail: its title is the subject, its message the body. Both
 * are already written, in the language the notification was created in.
 */
export function renderNotification(
  translator: MailTranslator,
  params: NotificationMailParams,
): RenderedMail {
  const { t } = translator;
  return renderLayout(translator, {
    subject: params.title,
    preheader: params.message,
    tag: t('notification.tag'),
    eyebrow: t('notification.eyebrow'),
    heading: params.title,
    paragraphs: [t('greeting', { name: params.name }), params.message],
    action: { label: t('notification.action'), url: params.url, backup: false },
    notes: [t('notification.settings')],
  });
}
