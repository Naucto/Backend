import { scrubMessage, scrubRoute, scrubStack } from './crash-scrub';

describe('crash scrubbing', () => {
  it('names a profile route by its pattern', () => {
    expect(scrubRoute('/u/ada')).toBe('/u/:username');
    expect(scrubRoute('/play/42')).toBe('/play/42');
  });

  it('drops URL queries and fragments, and tokens', () => {
    expect(scrubStack('at f (https://naucto.net/a.js?code=xyz#frag:1:2)')).toBe(
      'at f (https://naucto.net/a.js:1:2)',
    );
    expect(scrubStack('see https://naucto.net/sign-in?next=/u/ada')).toBe(
      'see https://naucto.net/sign-in',
    );
    expect(scrubStack('Bearer eyJhbGc.eyJzdWI.c2ln')).toBe('Bearer <token>');
  });

  it('hides emails in a message but leaves a Gecko frame of a stack alone', () => {
    expect(scrubMessage('Unique constraint on ada.l@example.co.uk failed')).toBe(
      'Unique constraint on <email> failed',
    );
    expect(scrubStack('render@https://naucto.net/main.js:1:2')).toBe(
      'render@https://naucto.net/main.js:1:2',
    );
  });

  it.each(['http', 'https', 'blob', 'file', 'HTTPS'])(
    'scrubs queries and fragments from %s URLs while preserving frame locations',
    (scheme) => {
      const url = `${scheme}://host/main.js`;
      expect(scrubStack(`${url}?secret=value:12:34)`)).toBe(`${url}:12:34)`);
      expect(scrubStack(`${url}#secret:12\n`)).toBe(`${url}:12\n`);
      expect(scrubStack(`${url}?secret:1:2:3`)).toBe(`${url}:2:3`);
      expect(scrubStack(`${url}?123`)).toBe(url);
      expect(scrubStack(`${url}#`)).toBe(url);
      expect(scrubStack(`${url}:12:34`)).toBe(`${url}:12:34`);
    },
  );

  it('preserves URL delimiters and scrubs each frame separately', () => {
    expect(
      scrubStack(
        'at f (https://host/a.js?secret:1:2)\nrender@blob:https://host/id#secret:3:4\n' +
          'see "file:///a.js?secret" and \'http://host/b.js#secret\'',
      ),
    ).toBe(
      'at f (https://host/a.js:1:2)\nrender@blob:https://host/id:3:4\n' +
        'see "file:///a.js" and \'http://host/b.js\'',
    );
  });

  it('handles long repeated schemes with and without fragments', () => {
    const schemes = 'blob://'.repeat(20_000);
    expect(scrubStack(schemes)).toBe(schemes);
    expect(scrubStack(`${schemes}?secret:12:34`)).toBe(`${schemes}:12:34`);
    expect(scrubStack('blob://#'.repeat(20_000))).toBe('blob://');
  });

  it('handles long numeric query values without losing frame locations', () => {
    const digits = '1'.repeat(20_000);
    expect(scrubStack(`https://host/a.js?${digits}`)).toBe('https://host/a.js');
    expect(scrubStack(`https://host/a.js?secret:${digits}:2`)).toBe(
      `https://host/a.js:${digits}:2`,
    );
  });
});
