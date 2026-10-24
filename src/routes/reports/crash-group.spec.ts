import { crashGroupKey, normalizeMessage } from './crash-group';

describe('crash groups', () => {
  it('takes ids, numbers and addresses out of a message', () => {
    expect(normalizeMessage('Release 42 failed at https://x.test/a?b=1 for 9f86d081884c7d65')).toBe(
      'Release <n> failed at <url> for <id>',
    );
  });

  it('gives one crash the same key whatever its ids', () => {
    expect(crashGroupKey('TypeError', 'Release 1 broke')).toBe(
      crashGroupKey('TypeError', 'Release 2  broke'),
    );
    expect(crashGroupKey('TypeError', 'Release 1 broke')).toBe('TypeError: Release <n> broke');
  });

  it('tells crashes of different names or messages apart', () => {
    expect(crashGroupKey('TypeError', 'boom')).not.toBe(crashGroupKey('RangeError', 'boom'));
    expect(crashGroupKey('TypeError', 'boom')).not.toBe(crashGroupKey('TypeError', 'bang'));
  });

  it('stays short enough to index', () => {
    expect(crashGroupKey('Error', 'x'.repeat(1000)).length).toBeLessThanOrEqual(300);
  });
});
