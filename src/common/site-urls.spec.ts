import { withEnv } from '../../test/env';
import { siteUrls } from './site-urls';

describe('siteUrls', () => {
  it('builds on the address of the web app, whatever slash it ends with', () => {
    withEnv({ FRONTEND_URL: 'https://naucto.example/' });

    expect(siteUrls.play(42)).toBe('https://naucto.example/play/42');
    expect(siteUrls.previewPlay(42)).toBe('https://naucto.example/staff/play/42');
    expect(siteUrls.previewEdit(42)).toBe('https://naucto.example/staff/edit/42');
  });

  it('escapes a handle', () => {
    withEnv({ FRONTEND_URL: 'https://naucto.example' });

    expect(siteUrls.profile('a/b c')).toBe('https://naucto.example/u/a%2Fb%20c');
  });
});
