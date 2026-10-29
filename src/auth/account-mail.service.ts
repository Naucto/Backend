import { Injectable } from '@nestjs/common';
import { EmailTokenPurpose } from '@prisma/client';

import { frontendLink } from '../config/frontend';
import { MailService } from '../mail/mail.service';
import { DEFAULT_MAIL_LOCALE } from '../mail/mail.types';
import { MailRenderer } from '../mail/mail-renderer.service';
import { EMAIL_TOKEN_LIFETIME_MS, EmailTokenService } from './email-token.service';

/** Web app routes the mailed links open; the page reads `token` and posts it back. */
export const VERIFY_EMAIL_PATH = '/verify-email';
export const RESET_PASSWORD_PATH = '/reset-password';

interface Recipient {
  id: number;
  email: string;
  username: string;
  nickname: string | null;
}

/** Issues the single-use links of an account and mails them. */
@Injectable()
export class AccountMailService {
  constructor(
    private readonly tokens: EmailTokenService,
    private readonly mail: MailService,
    private readonly renderer: MailRenderer,
  ) {}

  async sendVerification(user: Recipient): Promise<void> {
    const token = await this.tokens.issue(user.id, EmailTokenPurpose.VERIFY_EMAIL);
    const rendered = this.renderer.verifyEmail(DEFAULT_MAIL_LOCALE, {
      name: user.nickname ?? user.username,
      url: frontendLink(VERIFY_EMAIL_PATH, { token }),
      expiresInHours: EMAIL_TOKEN_LIFETIME_MS.VERIFY_EMAIL / (60 * 60 * 1000),
    });
    this.mail.sendInBackground({ to: user.email, ...rendered });
  }

  async sendPasswordReset(user: Recipient): Promise<void> {
    const token = await this.tokens.issue(user.id, EmailTokenPurpose.RESET_PASSWORD);
    const rendered = this.renderer.resetPassword(DEFAULT_MAIL_LOCALE, {
      name: user.nickname ?? user.username,
      url: frontendLink(RESET_PASSWORD_PATH, { token }),
      expiresInMinutes: EMAIL_TOKEN_LIFETIME_MS.RESET_PASSWORD / (60 * 1000),
    });
    this.mail.sendInBackground({ to: user.email, ...rendered });
  }
}
