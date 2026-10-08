import { isbot } from 'isbot';
import { UAParser } from 'ua-parser-js';

export type DeviceKind = 'desktop' | 'mobile' | 'tablet';

export interface UserAgentSummary {
  device: DeviceKind;
  /** Family names only: a version would raise cardinality and help fingerprinting. */
  browser: string | null;
  os: string | null;
}

const NAME_MAX_LENGTH = 40;
const UTM_MAX_LENGTH = 100;
const DOMAIN_MAX_LENGTH = 253;

const clip = (value: string | undefined, max: number): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** An absent user agent counts as a bot: every browser sends one. */
export function isBotUserAgent(userAgent: string | undefined): boolean {
  return !userAgent?.trim() || isbot(userAgent);
}

export function summarizeUserAgent(userAgent: string | undefined): UserAgentSummary {
  const result = new UAParser(userAgent ?? '').getResult();
  const type = result.device.type;
  return {
    device: type === 'mobile' || type === 'tablet' ? type : 'desktop',
    browser: clip(result.browser.name, NAME_MAX_LENGTH),
    os: clip(result.os.name, NAME_MAX_LENGTH),
  };
}

/**
 * The domain a visit came from, without `www.`; null for a direct visit, a referrer from the app
 * itself, or anything that is not an http(s) URL.
 */
export function referrerDomain(referrer: string | undefined, frontendUrl: string): string | null {
  if (!referrer) {
    return null;
  }
  let host: string;
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    host = url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  let selfHost: string | null = null;
  try {
    selfHost = new URL(frontendUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    selfHost = null;
  }
  if (!host || host === selfHost) {
    return null;
  }
  return host.slice(0, DOMAIN_MAX_LENGTH);
}

/** A campaign tag as an admin would group it: lowercase, printable, bounded. */
export function sanitizeUtm(value: string | undefined): string | null {
  const cleaned = value
    ?.normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ._+-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, UTM_MAX_LENGTH) : null;
}

/** The width of the viewport as a coarse bucket; the raw width is never stored. */
export function screenBucket(viewportWidth: number | undefined): string | null {
  if (viewportWidth === undefined || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return null;
  }
  if (viewportWidth < 576) {
    return 'xs';
  }
  if (viewportWidth < 768) {
    return 'sm';
  }
  if (viewportWidth < 1024) {
    return 'md';
  }
  if (viewportWidth < 1440) {
    return 'lg';
  }
  return 'xl';
}

/** The primary subtag of the first language a browser prefers, as in `fr` for `fr-FR,en;q=0.8`. */
export function primaryLanguage(acceptLanguage: string | undefined): string | null {
  const first = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim().toLowerCase();
  const primary = first?.split('-')[0];
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : null;
}
