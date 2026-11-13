import { ViewSaltService } from './view-salt.service';

describe('ViewSaltService', () => {
  const service = new ViewSaltService();

  it('keeps one salt through a UTC day', () => {
    const morning = service.saltOf(new Date('2026-10-08T00:00:00Z'));

    expect(morning).toHaveLength(32);
    expect(service.saltOf(new Date('2026-10-08T23:59:59Z'))).toBe(morning);
  });

  it('draws another when the day changes', () => {
    const before = service.saltOf(new Date('2026-10-08T23:59:59Z'));

    expect(service.saltOf(new Date('2026-10-09T00:00:00Z')).equals(before)).toBe(false);
  });
});
