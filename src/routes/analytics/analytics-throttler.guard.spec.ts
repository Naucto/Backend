import { ANALYTICS_THROTTLERS } from './analytics-throttler.guard';

const VISITOR = '11111111-1111-4111-8111-111111111111';

describe('analytics throttlers', () => {
  const tracker = (name: string): ((req: Record<string, unknown>) => string) => {
    const throttler = ANALYTICS_THROTTLERS.find((candidate) => candidate.name === name);
    if (!throttler?.getTracker) {
      throw new Error(`no ${name} throttler`);
    }
    const getTracker = throttler.getTracker;
    return (req) => getTracker(req, {} as never) as string;
  };

  it('keys a signed-in call by its account', () => {
    expect(
      tracker('identity')({ user: { id: 5 }, body: { visitorId: VISITOR }, ip: '1.2.3.4' }),
    ).toBe('u:5');
  });

  it('keys a consented report by its visitor', () => {
    expect(tracker('identity')({ user: null, body: { visitorId: VISITOR }, ip: '1.2.3.4' })).toBe(
      `v:${VISITOR}`,
    );
  });

  it('keys an anonymous ping, or an oversized id, by its address', () => {
    expect(tracker('identity')({ body: { kind: 'BEAT' }, ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
    expect(tracker('identity')({ body: { visitorId: 'x'.repeat(65) }, ip: '1.2.3.4' })).toBe(
      'ip:1.2.3.4',
    );
  });

  it('keeps a ceiling per address whatever ids a client invents', () => {
    expect(tracker('ip')({ body: { visitorId: VISITOR }, ip: '1.2.3.4' })).toBe('ip:1.2.3.4');
  });

  it('lets a whole school behind one address report every minute', () => {
    const ip = ANALYTICS_THROTTLERS.find((candidate) => candidate.name === 'ip');
    // A thousand visible tabs: one ping or beat each, plus their page-view batches.
    expect(ip?.limit).toBeGreaterThanOrEqual(1_000 * 4);
  });
});
