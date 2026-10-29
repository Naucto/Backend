import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { I18nTranslations } from '../i18n/i18n.generated';
import { MailLocale, RenderedMail } from './mail.types';
import { MailTranslator } from './mail-i18n';
import { NotificationMailParams, renderNotification } from './templates/notification.template';
import { renderResetPassword, ResetPasswordParams } from './templates/reset-password.template';
import { renderVerifyEmail, VerifyEmailParams } from './templates/verify-email.template';

/** Writes every mail the API sends, in the language it is asked for. */
@Injectable()
export class MailRenderer {
  constructor(private readonly i18n: I18nService<I18nTranslations>) {}

  verifyEmail(locale: MailLocale, params: VerifyEmailParams): RenderedMail {
    return renderVerifyEmail(this.translator(locale), params);
  }

  resetPassword(locale: MailLocale, params: ResetPasswordParams): RenderedMail {
    return renderResetPassword(this.translator(locale), params);
  }

  notification(locale: MailLocale, params: NotificationMailParams): RenderedMail {
    return renderNotification(this.translator(locale), params);
  }

  /**
   * One language's text; public so the layout can be checked on its own. A key English lacks
   * throws: the library answers it with its own name, which would otherwise reach an inbox.
   */
  translator(locale: MailLocale): MailTranslator {
    return {
      locale,
      t: (key, args) => {
        const path = `mail.${key}` as const;
        const text = this.i18n.t(path, { lang: locale, ...(args ? { args } : {}) });
        if (text === path) {
          throw new Error(`Missing mail translation "${path}"`);
        }
        return text;
      },
    };
  }
}
