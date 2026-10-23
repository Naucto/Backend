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
});
