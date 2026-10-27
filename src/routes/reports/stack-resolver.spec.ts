import { bundleOf, locationOf, StackResolver } from './stack-resolver';

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
      .mockImplementation((url: URL) =>
        Promise.resolve(
          url.href === 'https://naucto.test/chunk-AB12.js.map'
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

  it('only takes a bundle at the root of the web app, by its name alone', () => {
    const origin = 'https://naucto.test';
    expect(bundleOf('https://naucto.test/main-B45ANGGH.js', origin)).toBe('main-B45ANGGH.js');
    expect(bundleOf('https://naucto.test/a/b.js', origin)).toBeNull();
    expect(bundleOf('https://naucto.test/%2e%2e%2fadmin.js', origin)).toBeNull();
    expect(bundleOf('https://naucto.test.evil.test/main.js', origin)).toBeNull();
    expect(bundleOf('https://user@naucto.test:8443/main.js', origin)).toBeNull();
    expect(bundleOf('not a url', origin)).toBeNull();
  });

  it('reads a bounded part of a stack, however long it comes', async () => {
    const frame = '    at x (https://naucto.test/chunk-AB12.js:1:11)';
    const stack = Array.from({ length: 500 }, () => frame).join('\n');

    await resolver.resolve(stack);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  const madeUp = (from: number, count: number): string =>
    Array.from(
      { length: count },
      (_, i) => `    at x (https://naucto.test/b${String(from + i)}.js:1:1)`,
    ).join('\n');
  const realFrame = '    at e.update (https://naucto.test/chunk-AB12.js:1:11)';

  it('tries a handful of bundles a stack, however many it names', async () => {
    await resolver.resolve(madeUp(0, 250));

    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('fetches a bounded number of maps a minute across every report', async () => {
    for (let i = 0; i < 5; i++) {
      await resolver.resolve(madeUp(i * 8, 8), 1000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(20);

    await resolver.resolve(madeUp(100, 1), 1000 + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(21);
  });

  it('keeps a real map however many missing ones are asked for', async () => {
    await resolver.resolve(realFrame, 0);
    for (let i = 0; i < 40; i++) {
      await resolver.resolve(madeUp(i * 8, 8), (i + 1) * 60_000);
    }
    fetchMock.mockClear();

    await expect(resolver.resolve(realFrame, 50 * 60_000)).resolves.toContain(
      'src/app/player.ts:12:5',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
