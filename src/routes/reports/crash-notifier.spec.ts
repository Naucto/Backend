import { DiscordService } from '../../discord/discord.service';
import { CrashNotice, CrashNotifier } from './crash-notifier';

describe('CrashNotifier', () => {
  const notice: CrashNotice = {
    kind: 'regressed',
    reportId: 4,
    source: 'WEB',
    name: 'TypeError',
    message: 'x is `undefined`',
    stack: Array.from({ length: 12 }, (_, i) => `    at frame${String(i)}`).join('\n'),
    route: '/play/:id',
    count: 7,
    appRelease: '0.1.0+8f78127',
  };
  const discord = { send: jest.fn() };
  const env = { ...process.env };

  beforeEach(() => {
    discord.send.mockReset().mockResolvedValue(true);
    process.env = { ...env, DISCORD_CRASH_WEBHOOK_URL: 'https://discord.test/hook' };
    delete process.env['ADMIN_PANEL_URL'];
  });

  afterAll(() => {
    process.env = env;
  });

  const notifier = (): CrashNotifier => new CrashNotifier(discord as unknown as DiscordService);

  it('sends nothing without a webhook', async () => {
    delete process.env['DISCORD_CRASH_WEBHOOK_URL'];

    await notifier().notify(notice);

    expect(discord.send).not.toHaveBeenCalled();
  });

  it('posts the crash to the webhook with the top of its stack', async () => {
    await notifier().notify(notice);

    const [url, message] = discord.send.mock.calls[0] as [
      string,
      {
        embeds: { title: string; description: string; fields: { name: string; value: string }[] }[];
      },
    ];
    const [embed] = message.embeds;
    expect(url).toBe('https://discord.test/hook');
    expect(embed?.title).toBe('Crash is back after being resolved: TypeError');
    expect(embed?.description).toBe("```\nx is 'undefined'\n```");
    const stack = embed?.fields.find((field) => field.name === 'Stack')?.value ?? '';
    expect(stack).toContain('frame5');
    expect(stack).not.toContain('frame6');
  });

  it('links the crashes page of the admin console when it knows where it is', () => {
    process.env['ADMIN_PANEL_URL'] = 'https://admin.naucto.test/';

    const [embed] = notifier().message(notice).embeds ?? [];

    expect(embed?.url).toBe('https://admin.naucto.test/crashes');
  });
});
