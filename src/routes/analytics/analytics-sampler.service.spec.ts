import { Logger } from '@nestjs/common';

import { PresenceService } from '../../presence/presence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { AnalyticsSamplerService } from './analytics-sampler.service';

const MINUTE = new Date(Date.UTC(2026, 9, 8, 12, 0, 0));

describe('AnalyticsSamplerService', () => {
  let tx: {
    $queryRaw: jest.Mock;
    concurrencySample: { createMany: jest.Mock };
    analyticsLiveMinute: { deleteMany: jest.Mock };
  };
  const prisma = { $transaction: jest.fn() };
  const presence = { countsByKind: jest.fn() };
  const features = { features: { monetization: false, analytics: true } };
  let service: AnalyticsSamplerService;

  beforeEach(() => {
    jest.useFakeTimers({ now: MINUTE.getTime() - 60 * 60_000 });
    tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([
          { state: 'PLAYING', count: 3 },
          { state: 'BROWSING', count: 5 },
        ])
        .mockResolvedValueOnce([{ state: 'BUILDING', count: 2 }]),
      concurrencySample: { createMany: jest.fn() },
      analyticsLiveMinute: { deleteMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((run: (client: typeof tx) => unknown) => run(tx));
    presence.countsByKind.mockReturnValue({ IDLE: 4, PLAYING: 1, BUILDING: 0, HOSTING: 1 });
    features.features.analytics = true;
    service = new AnalyticsSamplerService(
      prisma as unknown as PrismaService,
      presence as unknown as PresenceService,
      features as unknown as FeaturesService,
    );
    jest.useRealTimers();
  });

  it('writes the three series of a minute, split by state', async () => {
    await service.sample(MINUTE);

    expect(tx.concurrencySample.createMany).toHaveBeenCalledWith({
      data: [
        {
          at: MINUTE,
          activeBrowsers: 8,
          activeBrowsersPlaying: 3,
          activeBrowsersBuilding: 0,
          activeBrowsersHosting: 0,
          anonTabs: 2,
          anonTabsPlaying: 0,
          anonTabsBuilding: 2,
          anonTabsHosting: 0,
          accounts: 6,
          accountsPlaying: 1,
          accountsBuilding: 0,
          accountsHosting: 1,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('leaves the minute to another instance holding the sampler lock', async () => {
    tx.$queryRaw.mockReset().mockResolvedValueOnce([{ locked: false }]);

    await service.sample(MINUTE);

    expect(tx.concurrencySample.createMany).not.toHaveBeenCalled();
  });

  it('drops live minutes older than two hours', async () => {
    await service.sample(MINUTE);

    expect(tx.analyticsLiveMinute.deleteMany).toHaveBeenCalledWith({
      where: { minute: { lt: new Date(MINUTE.getTime() - 2 * 60 * 60_000) } },
    });
  });

  it('samples the minute that started 90 seconds ago', async () => {
    const sample = jest.spyOn(service, 'sample').mockResolvedValue();

    await service.sampleLastMinute(new Date(MINUTE.getTime() + 90_000));

    expect(sample).toHaveBeenCalledWith(MINUTE);
  });

  it('leaves unsampled a minute the process was not up for, and every minute while analytics is off', async () => {
    const sample = jest.spyOn(service, 'sample').mockResolvedValue();
    const late = new AnalyticsSamplerService(
      prisma as unknown as PrismaService,
      presence as unknown as PresenceService,
      features as unknown as FeaturesService,
    );
    const lateSample = jest.spyOn(late, 'sample').mockResolvedValue();

    await late.sampleLastMinute(new Date(Date.now() + 30_000));
    expect(lateSample).not.toHaveBeenCalled();

    features.features.analytics = false;
    await service.sampleLastMinute(new Date(MINUTE.getTime() + 90_000));
    expect(sample).not.toHaveBeenCalled();
  });

  it('logs a failed sample instead of throwing from the schedule', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma.$transaction.mockRejectedValueOnce(new Error('database is gone'));

    await expect(
      service.sampleLastMinute(new Date(MINUTE.getTime() + 90_000)),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('database is gone'));
  });
});
