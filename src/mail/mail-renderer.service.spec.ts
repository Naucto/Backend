import { Test } from '@nestjs/testing';
import escapeHtml from 'escape-html';
import { I18nModule } from 'nestjs-i18n';

import { withEnv } from '../../test/env';
import { MAIL_I18N_OPTIONS, MailKey } from './mail-i18n';
import { MailRenderer } from './mail-renderer.service';
import { MailLayout, renderLayout } from './templates/layout';

/** The renderer over the real translation files, so a key missing from them fails here. */
async function buildRenderer(): Promise<MailRenderer> {
  const module = await Test.createTestingModule({
    imports: [I18nModule.forRoot(MAIL_I18N_OPTIONS)],
    providers: [MailRenderer],
  }).compile();
  await module.init();
  return module.get(MailRenderer);
}

describe('MailRenderer', () => {
  let renderer: MailRenderer;

  beforeAll(async () => {
    renderer = await buildRenderer();
  });

  it('should put the confirmation link in both the HTML and the text', () => {
    const url = 'http://localhost:3001/verify-email?token=abc';
    const mail = renderer.verifyEmail('en', { name: 'Ada', url, expiresInHours: 24 });

    expect(mail.subject).toBe('Confirm your email address');
    expect(mail.html).toContain('Hi Ada, thanks for signing up.');
    expect(mail.html).toContain(`href="${escapeHtml(url)}"`);
    expect(mail.text).toContain(url);
    expect(mail.text).toContain('expires in 24 hours');
  });

  it('should state how long a reset link lasts', () => {
    const mail = renderer.resetPassword('en', {
      name: 'Ada',
      url: 'http://localhost:3001/reset-password?token=abc',
      expiresInMinutes: 60,
    });

    expect(mail.subject).toBe('Reset your password');
    expect(mail.html).toContain('>Security</td>');
    expect(mail.text).toContain('expires in 60 minutes');
  });

  it('should escape what users wrote, so a notification cannot carry markup', () => {
    const mail = renderer.notification('en', {
      name: '<b>Ada</b>',
      title: 'Invite',
      message: 'Bob invited you to play <script>alert(1)</script>',
      url: 'http://localhost:3001/',
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).not.toContain('<b>Ada</b>');
    // Plain text needs no escaping.
    expect(mail.text).toContain('<script>alert(1)</script>');
  });

  it('should throw on a key the translation files lack, rather than mail its name', () => {
    const { t } = renderer.translator('en');

    expect(() => t('verifyEmail.nothingHere' as MailKey)).toThrow();
  });

  it('should leave no placeholder unfilled', () => {
    const mails = [
      renderer.verifyEmail('en', { name: 'Ada', url: 'https://x', expiresInHours: 24 }),
      renderer.resetPassword('en', { name: 'Ada', url: 'https://x', expiresInMinutes: 60 }),
      renderer.notification('en', { name: 'Ada', title: 'T', message: 'M', url: 'https://x' }),
    ];

    for (const mail of mails) {
      expect(mail.text).not.toMatch(/\{\w+\}/);
    }
  });
});

describe('mail layout', () => {
  let renderer: MailRenderer;
  const base: MailLayout = {
    subject: 'Subject',
    preheader: 'Preview line',
    tag: 'Welcome',
    eyebrow: 'Verification',
    heading: 'Heading',
    paragraphs: ['Body'],
    notes: ['Note'],
  };

  beforeAll(async () => {
    renderer = await buildRenderer();
  });

  const render = (layout: MailLayout): ReturnType<typeof renderLayout> =>
    renderLayout(renderer.translator('en'), layout);

  it('should draw the logo, the tag and the hidden preview line', () => {
    withEnv({ FRONTEND_URL: 'https://naucto.net' });
    const mail = render(base);

    expect(mail.html).toContain('<html lang="en"');
    expect(mail.html).toContain('src="https://naucto.net/img/email-logo.png"');
    expect(mail.html).toContain('>Welcome</td>');
    expect(mail.html).toContain('Preview line');
    expect(mail.html).toContain('href="https://naucto.net/privacy"');
    expect(mail.html).toContain('>naucto.net</a>');
  });

  it('should draw the screen block only for a mail that carries a code', () => {
    expect(render(base).html).not.toContain('&gt; code:');

    const mail = render({ ...base, code: { label: 'code', value: '482913' } });
    expect(mail.html).toContain('&gt; code:');
    expect(mail.text).toContain('code: 482913');
  });

  it('should write the link out under the button, for clients that do not follow it', () => {
    const mail = render({
      ...base,
      action: { label: 'Go', url: 'https://naucto.net/x?a=1&b=2', backup: true },
    });

    expect(mail.html).toContain('Backup link');
    expect(mail.html).toContain('https://naucto.net/x?a=1&amp;b=2</a>');
    expect(mail.text).toContain('Go: https://naucto.net/x?a=1&b=2');
  });

  it('should leave the link out when it is only a way to the site', () => {
    const mail = render({
      ...base,
      action: { label: 'Open', url: 'https://naucto.net/', backup: false },
    });

    expect(mail.html).toContain('>Open</a>');
    expect(mail.html).not.toContain('Backup link');
  });
});
