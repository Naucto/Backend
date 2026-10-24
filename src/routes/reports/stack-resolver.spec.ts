import { locationOf, StackResolver } from './stack-resolver';

// Generated line 1, column 11 (0-based 10) maps to src/app/player.ts line 12, column 5.
const MAP = JSON.stringify({
  version: 3,
  sources: ['webpack:///./src/app/player.ts'],
  names: [],
  mappings: 'AAAA,UAWI',
});

describe('StackResolver', () => {
  const fetchMock = jest.fn();
  const env = { ...process.env };
  let resolver: StackResolver;

  beforeEach(() => {
    process.env = { ...env, FRONTEND_URL: 'https://naucto.test' };
    fetchMock
      .mockReset()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url === 'https://naucto.test/chunk-AB12.js.map'
            ? { ok: true, headers: new Headers(), text: () => Promise.resolve(MAP) }
            : { ok: false, headers: new Headers(), text: () => Promise.resolve('') },
        ),
      );
    global.fetch = fetchMock as unknown as typeof fetch;
    resolver = new StackResolver();
    jest.spyOn(resolver['logger'], 'warn').mockImplementation();
  });

  afterAll(() => {
    process.env = env;
  });

  it('maps a V8 and a Gecko frame of the web app back to the source', async () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'x')",
      '    at e.update (https://naucto.test/chunk-AB12.js:1:11)',
      'update@https://naucto.test/chunk-AB12.js:1:11',
    ].join('\n');

    await expect(resolver.resolve(stack)).resolves.toBe(
      [
        "TypeError: Cannot read properties of undefined (reading 'x')",
        '    at e.update (src/app/player.ts:12:5)',
        'update@src/app/player.ts:12:5',
      ].join('\n'),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never fetches from another origin, and leaves those frames as they are', async () => {
    const stack = '    at x (https://evil.test/chunk-AB12.js:1:11)';

    await expect(resolver.resolve(stack)).resolves.toBe(stack);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a frame whose map is missing, and asks again only later', async () => {
    const stack = '    at x (https://naucto.test/main-ZZ.js:3:44)';

    await expect(resolver.resolve(stack, 0)).resolves.toBe(stack);
    await resolver.resolve(stack, 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await resolver.resolve(stack, 11 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads a location only off a script with a line and a column', () => {
    expect(locationOf('https://naucto.test/a.js:3:44')).toEqual({
      url: 'https://naucto.test/a.js',
      line: 3,
      column: 44,
    });
    expect(locationOf('https://naucto.test/a.css:3:44')).toBeNull();
    expect(locationOf('https://naucto.test/a.js')).toBeNull();
    expect(locationOf(':'.repeat(5000))).toBeNull();
  });
});
