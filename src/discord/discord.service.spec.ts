import { codeBlock, DISCORD_MESSAGES_PER_MINUTE, DiscordService } from './discord.service';

describe('DiscordService', () => {
  const fetchMock = jest.fn();
  const hook = 'https://discord.test/api/webhooks/1/abc';
  let discord: DiscordService;

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;
    discord = new DiscordService();
    jest.spyOn(discord['logger'], 'warn').mockImplementation();
  });

  const sentBody = (): Record<string, unknown> =>
    JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as Record<
      string,
      unknown
    >;

  it('posts the message without letting it mention anyone', async () => {
    await expect(discord.send(hook, { content: '@everyone look' })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(hook, expect.objectContaining({ method: 'POST' }));
    expect(sentBody()).toEqual({ content: '@everyone look', allowed_mentions: { parse: [] } });
  });

  it('cuts every part of an embed to what Discord takes', async () => {
    await discord.send(hook, {
      embeds: [
        {
          title: 't'.repeat(300),
          fields: Array.from({ length: 30 }, () => ({ name: 'n', value: 'v'.repeat(2000) })),
        },
      ],
    });

    const [embed] = sentBody()['embeds'] as { title: string; fields: { value: string }[] }[];
    expect(embed?.title).toHaveLength(256);
    expect(embed?.fields).toHaveLength(25);
    expect(embed?.fields[0]?.value).toHaveLength(1024);
  });

  it('holds back past the per-minute budget of a webhook, and only that one', async () => {
    for (let i = 0; i <= DISCORD_MESSAGES_PER_MINUTE; i++) {
      await discord.send(hook, { content: 'x' }, 1000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(DISCORD_MESSAGES_PER_MINUTE);

    await discord.send(`${hook}2`, { content: 'x' }, 1000);
    await discord.send(hook, { content: 'x' }, 1000 + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(DISCORD_MESSAGES_PER_MINUTE + 2);
  });

  it('answers false and never throws when Discord is down or refuses', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(discord.send(hook, { content: 'x' })).resolves.toBe(false);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(discord.send(hook, { content: 'x' })).resolves.toBe(false);
  });

  it('keeps backticks from closing a code block', () => {
    expect(codeBlock('a `b` c')).toBe("```\na 'b' c\n```");
    expect(codeBlock('x'.repeat(2000), 100)).toHaveLength(100);
  });
});
