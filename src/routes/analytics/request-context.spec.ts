import {
  isBotUserAgent,
  primaryLanguage,
  referrerDomain,
  sanitizeUtm,
  screenBucket,
  summarizeUserAgent,
} from './request-context';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SAFARI_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

describe('request context', () => {
  describe('isBotUserAgent', () => {
    it.each([
      ['a crawler', GOOGLEBOT],
      ['a missing user agent', undefined],
      ['a blank user agent', '  '],
      ['a scripted client', 'curl/8.5.0'],
    ])('treats %s as a bot', (_case, userAgent) => {
      expect(isBotUserAgent(userAgent)).toBe(true);
    });

    it('lets a browser through', () => {
      expect(isBotUserAgent(CHROME_WINDOWS)).toBe(false);
    });
  });

  describe('summarizeUserAgent', () => {
    it.each([
      [CHROME_WINDOWS, { device: 'desktop', browser: 'Chrome', os: 'Windows' }],
      [SAFARI_IPHONE, { device: 'mobile', browser: 'Mobile Safari', os: 'iOS' }],
      [SAFARI_IPAD, { device: 'tablet', browser: 'Mobile Safari', os: 'iOS' }],
    ])('names the family of %s without its version', (userAgent, expected) => {
      expect(summarizeUserAgent(userAgent)).toEqual(expected);
    });

    it('reads an unknown agent as a desktop with no names', () => {
      expect(summarizeUserAgent('')).toEqual({ device: 'desktop', browser: null, os: null });
    });
  });

  describe('referrerDomain', () => {
    const frontend = 'https://www.naucto.net';

    it.each([
      ['https://www.google.com/search?q=naucto', 'google.com'],
      ['http://Reddit.com/r/gamedev/comments/1', 'reddit.com'],
      ['https://sub.example.org:8443/a#b', 'sub.example.org'],
    ])('keeps only the domain of %s', (referrer, expected) => {
      expect(referrerDomain(referrer, frontend)).toBe(expected);
    });

    it.each([
      ['a direct visit', undefined],
      ['the app itself', 'https://naucto.net/play/4'],
      ['the app itself with www', 'https://www.naucto.net/hub'],
      ['an app scheme', 'android-app://com.google.android.gm'],
      ['garbage', 'not a url'],
    ])('treats %s as direct', (_case, referrer) => {
      expect(referrerDomain(referrer, frontend)).toBeNull();
    });
  });

  describe('sanitizeUtm', () => {
    it('lowercases, keeps printable characters and bounds the length', () => {
      expect(sanitizeUtm('  Spring_Launch 2026!<script>  ')).toBe('spring_launch 2026script');
      expect(sanitizeUtm('x'.repeat(300))?.length).toBe(100);
    });

    it.each([undefined, '', '   ', '<>'])('drops an empty tag (%p)', (value) => {
      expect(sanitizeUtm(value)).toBeNull();
    });
  });

  describe('screenBucket', () => {
    it.each([
      [375, 'xs'],
      [600, 'sm'],
      [800, 'md'],
      [1280, 'lg'],
      [2560, 'xl'],
    ])('buckets a %ipx viewport as %s', (width, bucket) => {
      expect(screenBucket(width)).toBe(bucket);
    });

    it.each([undefined, 0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
      'has no bucket for %p',
      (width) => {
        expect(screenBucket(width)).toBeNull();
      },
    );
  });

  describe('primaryLanguage', () => {
    it.each([
      ['fr-FR,fr;q=0.9,en;q=0.8', 'fr'],
      ['EN-us', 'en'],
      ['gsw', 'gsw'],
    ])('reads %s as %s', (header, language) => {
      expect(primaryLanguage(header)).toBe(language);
    });

    it.each([undefined, '', '*', '12-34'])('has no language for %p', (header) => {
      expect(primaryLanguage(header)).toBeNull();
    });
  });
});
