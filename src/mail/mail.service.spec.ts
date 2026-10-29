import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';

import { withEnv } from '../../test/env';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const message = { to: 'ada@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' };

describe('MailService', () => {
  const sendMail = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    (createTransport as jest.Mock).mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be disabled, and drop every mail, without SMTP_HOST', async () => {
    withEnv({ SMTP_HOST: undefined });
    const service = new MailService();

    expect(service.enabled).toBe(false);
    await service.send(message);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('should speak TLS from the first byte on port 465 and log in when given credentials', () => {
    withEnv({
      SMTP_HOST: 'ssl0.ovh.net',
      SMTP_PORT: '465',
      SMTP_SECURE: undefined,
      SMTP_USER: 'noreply@naucto.net',
      SMTP_PASSWORD: 'secret',
    });
    new MailService();

    expect(createTransport).toHaveBeenCalledWith({
      host: 'ssl0.ovh.net',
      port: 465,
      secure: true,
      auth: { user: 'noreply@naucto.net', pass: 'secret' },
    });
  });

  it('should connect without credentials or implicit TLS to a local catcher', () => {
    withEnv({
      SMTP_HOST: 'mailpit',
      SMTP_PORT: '1025',
      SMTP_SECURE: undefined,
      SMTP_USER: undefined,
      SMTP_PASSWORD: undefined,
    });
    new MailService();

    expect(createTransport).toHaveBeenCalledWith({ host: 'mailpit', port: 1025, secure: false });
  });

  it('should send from MAIL_FROM', async () => {
    withEnv({ SMTP_HOST: 'mailpit', MAIL_FROM: 'Naucto <hello@naucto.net>' });
    await new MailService().send(message);

    expect(sendMail).toHaveBeenCalledWith({ from: 'Naucto <hello@naucto.net>', ...message });
  });

  it('should log, not raise, a mail sent in the background that the server refuses', async () => {
    withEnv({ SMTP_HOST: 'mailpit' });
    sendMail.mockRejectedValueOnce(new Error('550 mailbox unavailable'));
    const service = new MailService();

    expect(() => service.sendInBackground(message)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('550 mailbox unavailable'),
    );
    // The address is masked in logs.
    expect(Logger.prototype.error).not.toHaveBeenCalledWith(
      expect.stringContaining('ada@example.com'),
    );
  });
});
