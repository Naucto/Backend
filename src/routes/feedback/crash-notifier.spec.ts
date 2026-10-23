import { CRASH_NOTICES_PER_MINUTE, CrashNotice, CrashNotifier } from './crash-notifier';

describe('CrashNotifier', () => {
  const notice: CrashNotice = {
    kind: 'new',
    groupId: 4,
    source: 'WEB',
    name: 'TypeError',
    message: 'x is `undefined`',
    stack: Array.from({ length: 12 }, (_, i) => `    at frame${String(i)}`).join('\n'),
    route: '/play/:id',
    count: 1,
    appRelease: '8f78127f',
  };
  const fetchMock = jest.fn();
  const env = { ...process.env };

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env = { ...env, DISCORD_CRASH_WEBHOOK_URL: 'https://discord.test/hook' };
    delete process.env['ADMIN_PANEL_URL'];
  });

  afterAll(() => {
    process.env = env;
  });

  const quiet = (notifier: CrashNotifier): CrashNotifier => {
    jest.spyOn(notifier['logger'], 'warn').mockImplementation();
    return notifier;
  };

  it('sends nothing without a webhook', async () => {
    delete process.env['DISCORD_CRASH_WEBHOOK_URL'];

    await new CrashNotifier().notify(notice);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts an embed that mentions no one and keeps backticks inside its code blocks', async () => {
    await new CrashNotifier().notify(notice);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.test/hook',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      allowed_mentions: unknown;
      embeds: { title: string; description: string; fields: { name: string; value: string }[] }[];
    };
    const [embed] = body.embeds;
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(embed?.title).toBe('New crash: TypeError');
    expect(embed?.description).toBe("```\nx is 'undefined'\n```");
    const stack = embed?.fields.find((field) => field.name === 'Stack')?.value ?? '';
    expect(stack).toContain('frame5');
    expect(stack).not.toContain('frame6');
  });

  it('links the admin console when it knows where it is', () => {
    process.env['ADMIN_PANEL_URL'] = 'https://admin.naucto.test/';

    const [embed] = new CrashNotifier().payload(notice)['embeds'] as { url?: string }[];

    expect(embed?.url).toBe('https://admin.naucto.test/crashes');
  });

  it('holds back past the per-minute budget', async () => {
    const notifier = quiet(new CrashNotifier());

    for (let i = 0; i <= CRASH_NOTICES_PER_MINUTE; i++) {
      await notifier.notify(notice, 1000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(CRASH_NOTICES_PER_MINUTE);

    await notifier.notify(notice, 1000 + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(CRASH_NOTICES_PER_MINUTE + 1);
  });

  it('never throws when Discord is down', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    await expect(quiet(new CrashNotifier()).notify(notice)).resolves.toBeUndefined();
  });
});
