import { PrismaService } from '../../prisma/prisma.service';
import { PublishedReleasesService } from './published-releases.service';

describe('PublishedReleasesService', () => {
  const prisma = { project: { findMany: jest.fn(), findFirst: jest.fn() } };
  let service: PublishedReleasesService;
  const T0 = 1_000_000;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.project.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.project.findFirst.mockResolvedValue(null);
    service = new PublishedReleasesService(prisma as unknown as PrismaService);
  });

  it('answers from the set of published games it loaded', async () => {
    expect(await service.isPublished(1, T0)).toBe(true);
    expect(await service.isPublished(2, T0)).toBe(true);

    expect(prisma.project.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });

  it('asks the database about an id it does not know, so a new release is never refused', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: 3 });

    expect(await service.isPublished(3, T0)).toBe(true);
    expect(await service.isPublished(3, T0 + 1)).toBe(true);

    expect(prisma.project.findFirst).toHaveBeenCalledTimes(1);
  });

  it('remembers an unpublished id for a minute, then asks again', async () => {
    expect(await service.isPublished(9, T0)).toBe(false);
    expect(await service.isPublished(9, T0 + 30_000)).toBe(false);
    expect(prisma.project.findFirst).toHaveBeenCalledTimes(1);

    prisma.project.findFirst.mockResolvedValueOnce({ id: 9 });
    expect(await service.isPublished(9, T0 + 61_000)).toBe(true);
  });

  it('reloads the published set every five minutes', async () => {
    await service.isPublished(1, T0);
    await service.isPublished(1, T0 + 4 * 60_000);
    prisma.project.findMany.mockResolvedValueOnce([{ id: 2 }]);
    prisma.project.findFirst.mockResolvedValueOnce(null);

    expect(await service.isPublished(1, T0 + 6 * 60_000)).toBe(false);
    expect(prisma.project.findMany).toHaveBeenCalledTimes(2);
  });
});
