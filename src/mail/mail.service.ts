import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';

import { getOptionalEnv } from '../config/env';
import { MailMessage } from './mail.types';

const DEFAULT_FROM = 'Naucto <noreply@naucto.net>';
const IMPLICIT_TLS_PORT = 465;

/** The recipient as logs may show it: enough to tell two apart, not enough to read the address. */
function maskAddress(address: string): string {
  const [local = '', domain = ''] = address.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from = getOptionalEnv('MAIL_FROM', DEFAULT_FROM);

  constructor() {
    const host = getOptionalEnv('SMTP_HOST');
    if (host === undefined) {
      this.logger.warn('SMTP_HOST is not set: mail is disabled and nothing will be sent');
      this.transport = null;
      return;
    }

    const port = getOptionalEnv('SMTP_PORT', IMPLICIT_TLS_PORT);
    const user = getOptionalEnv('SMTP_USER');
    const pass = getOptionalEnv('SMTP_PASSWORD');

    this.transport = createTransport({
      host,
      port,
      secure: getOptionalEnv('SMTP_SECURE', port === IMPLICIT_TLS_PORT),
      ...(user !== undefined && pass !== undefined ? { auth: { user, pass } } : {}),
    });
    this.logger.log(`Mail goes out through ${host}:${String(port)} as ${this.from}`);
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  /** Throws when the server refuses the message; a disabled service drops it with a warning. */
  async send(message: MailMessage): Promise<void> {
    if (!this.transport) {
      this.logger.warn(`Mail disabled, dropped "${message.subject}" to ${maskAddress(message.to)}`);
      return;
    }

    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    this.logger.log(`Sent "${message.subject}" to ${maskAddress(message.to)}`);
  }

  /**
   * Sends without making the caller wait or fail: the operation that asked for the mail has
   * already happened, and a slow or failing mail server must not undo it or hold the response.
   */
  sendInBackground(message: MailMessage): void {
    this.send(message).catch((error: unknown) => {
      this.logger.error(
        `Could not send "${message.subject}" to ${maskAddress(message.to)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}
