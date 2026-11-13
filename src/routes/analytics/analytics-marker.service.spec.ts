import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsMarkerService } from './analytics-marker.service';

const AT = new Date('2026-10-20T18:00:00Z');
const row = {
  id: 1,
  at: AT,
  label: 'Trailer',
  channel: 'YouTube',
  url: 'https://youtube.com/watch?v=1',
  audience: 'PLAYERS',
  releaseId: 9,
  createdAt: AT,
  updatedAt: AT,
};

describe('AnalyticsMarkerService', () => {
  const prisma = {
    analyticsMarker: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    project: { findMany: jest.fn() },
  };
  let service: AnalyticsMarkerService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.project.findMany.mockResolvedValue([{ id: 9, name: 'draft', publishedName: 'Orbs' }]);
    service = new AnalyticsMarkerService(prisma as unknown as PrismaService);
  });

  it('lists the markers of a window with the name of the game they promote', async () => {
    prisma.analyticsMarker.findMany.mockResolvedValue([row]);

    const { markers } = await service.list({
      from: '2026-10-20T00:00:00Z',
      to: '2026-10-21T00:00:00Z',
    });

    expect(prisma.analyticsMarker.findMany).toHaveBeenCalledWith({
      where: {
        at: { gte: new Date('2026-10-20T00:00:00Z'), lt: new Date('2026-10-21T00:00:00Z') },
      },
      orderBy: { at: 'asc' },
    });
    expect(markers[0]).toMatchObject({ id: 1, game: 'Orbs', at: '2026-10-20T18:00:00.000Z' });
  });

  it('stores blank optional text as nothing, and a post for everyone unless told otherwise', async () => {
    prisma.analyticsMarker.create.mockResolvedValue({ ...row, channel: null, releaseId: null });

    await service.create({ at: AT.toISOString(), label: ' Trailer ', channel: '  ' });

    expect(prisma.analyticsMarker.create).toHaveBeenCalledWith({
      data: {
        at: AT,
        label: 'Trailer',
        channel: null,
        url: null,
        audience: 'EVERYONE',
        releaseId: null,
      },
    });
  });

  it('clears an optional field given null and leaves out what was not given', async () => {
    prisma.analyticsMarker.update.mockResolvedValue({ ...row, url: null });

    await service.update(1, { url: null, label: 'Teaser' });

    expect(prisma.analyticsMarker.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { label: 'Teaser', url: null },
    });
  });

  it('answers 404 for a marker that does not exist', async () => {
    const missing = new Prisma.PrismaClientKnownRequestError('No record', {
      code: 'P2025',
      clientVersion: 'test',
    });
    prisma.analyticsMarker.delete.mockRejectedValue(missing);
    prisma.analyticsMarker.update.mockRejectedValue(missing);

    await expect(service.remove(4)).rejects.toThrow(NotFoundException);
    await expect(service.update(4, { label: 'x' })).rejects.toThrow(NotFoundException);
  });
});
