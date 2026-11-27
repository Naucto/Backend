import { MailService } from '../mail/mail.service';
import { MailRenderer } from '../mail/mail-renderer.service';
import { AccountMailService } from './account-mail.service';
import { EmailTokenService } from './email-token.service';

describe('AccountMailService', () => {
  const user = { id: 3, email: 'ada@example.com', username: 'ada', nickname: null };
  const rendered = { subject: 'subject', html: '<p>html</p>', text: 'text' };

  let tokens: { issue: jest.Mock };
  let mail: { sendInBackground: jest.Mock };
  let service: AccountMailService;

  beforeEach(() => {
    tokens = { issue: jest.fn() };
    mail = { sendInBackground: jest.fn() };
    const renderer = {
      verifyEmail: jest.fn().mockReturnValue(rendered),
      resetPassword: jest.fn().mockReturnValue(rendered),
    };
    service = new AccountMailService(
      tokens as unknown as EmailTokenService,
      mail as unknown as MailService,
      renderer as unknown as MailRenderer,
    );
  });

  it.each([
    ['confirmation', 'sendVerification', 'VERIFY_EMAIL'],
    ['reset', 'sendPasswordReset', 'RESET_PASSWORD'],
  ] as const)('should mail the %s link it was issued', async (_kind, send, purpose) => {
    tokens.issue.mockResolvedValue('the-token');

    await service[send](user);

    expect(tokens.issue).toHaveBeenCalledWith(3, purpose);
    expect(mail.sendInBackground).toHaveBeenCalledWith({ to: 'ada@example.com', ...rendered });
  });

  it.each([
    ['confirmation', 'sendVerification'],
    ['reset', 'sendPasswordReset'],
  ] as const)(
    'should mail nothing when no %s link was issued during the cooldown',
    async (_kind, send) => {
      tokens.issue.mockResolvedValue(null);

      await service[send](user);

      expect(mail.sendInBackground).not.toHaveBeenCalled();
    },
  );
});
