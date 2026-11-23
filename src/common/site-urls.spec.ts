import { withEnv } from '../../test/env';
import { uuidOf } from '../../test/uuid';
import { siteUrls } from './site-urls';

describe('siteUrls', () => {
  it('builds on the address of the web app, whatever slash it ends with', () => {
    withEnv({ FRONTEND_URL: 'https://naucto.example/' });

    const id = uuidOf(42);
    expect(siteUrls.play(id)).toBe(`https://naucto.example/play/${id}`);
    expect(siteUrls.previewPlay(id)).toBe(`https://naucto.example/staff/play/${id}`);
    expect(siteUrls.previewEdit(id)).toBe(`https://naucto.example/staff/edit/${id}`);
  });

  it('escapes a handle', () => {
    withEnv({ FRONTEND_URL: 'https://naucto.example' });

    expect(siteUrls.profile('a/b c')).toBe('https://naucto.example/u/a%2Fb%20c');
  });
});
