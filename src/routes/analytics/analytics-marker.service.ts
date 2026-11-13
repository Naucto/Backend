import { Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsMarker, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AnalyticsMarkerDto,
  AnalyticsMarkersDto,
  AnalyticsMarkersQueryDto,
  CreateAnalyticsMarkerDto,
  UpdateAnalyticsMarkerDto,
} from './dto/analytics-marker.dto';

/** The moments admins mark on the charts, such as a post going out. */
@Injectable()
export class AnalyticsMarkerService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AnalyticsMarkersQueryDto): Promise<AnalyticsMarkersDto> {
    const markers = await this.prisma.analyticsMarker.findMany({
      where: {
        at: {
          ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
          ...(query.to === undefined ? {} : { lt: new Date(query.to) }),
        },
      },
      orderBy: { at: 'asc' },
    });
    const names = await this.namesOf(markers);
    return { markers: markers.map((marker) => this.toDto(marker, names)) };
  }

  async create(dto: CreateAnalyticsMarkerDto): Promise<AnalyticsMarkerDto> {
    const marker = await this.prisma.analyticsMarker.create({
      data: {
        at: new Date(dto.at),
        label: dto.label.trim(),
        channel: dto.channel?.trim() || null,
        url: dto.url ?? null,
        audience: dto.audience ?? 'EVERYONE',
        releaseId: dto.releaseId ?? null,
      },
    });
    return this.toDto(marker, await this.namesOf([marker]));
  }

  async update(id: number, dto: UpdateAnalyticsMarkerDto): Promise<AnalyticsMarkerDto> {
    const data: Prisma.AnalyticsMarkerUpdateInput = {
      ...(dto.at ? { at: new Date(dto.at) } : {}),
      ...(dto.label ? { label: dto.label.trim() } : {}),
      ...(dto.channel === undefined ? {} : { channel: dto.channel?.trim() || null }),
      ...(dto.url === undefined ? {} : { url: dto.url }),
      ...(dto.audience ? { audience: dto.audience } : {}),
      ...(dto.releaseId === undefined ? {} : { releaseId: dto.releaseId }),
    };
    try {
      const marker = await this.prisma.analyticsMarker.update({ where: { id }, data });
      return this.toDto(marker, await this.namesOf([marker]));
    } catch (error) {
      throw this.missing(error);
    }
  }

  async remove(id: number): Promise<void> {
    try {
      await this.prisma.analyticsMarker.delete({ where: { id } });
    } catch (error) {
      throw this.missing(error);
    }
  }

  private missing(error: unknown): unknown {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
      ? new NotFoundException('No such marker')
      : error;
  }

  private toDto(marker: AnalyticsMarker, names: Map<number, string>): AnalyticsMarkerDto {
    return {
      id: marker.id,
      at: marker.at.toISOString(),
      label: marker.label,
      channel: marker.channel,
      url: marker.url,
      audience: marker.audience,
      releaseId: marker.releaseId,
      game: marker.releaseId === null ? null : (names.get(marker.releaseId) ?? null),
      createdAt: marker.createdAt.toISOString(),
      updatedAt: marker.updatedAt.toISOString(),
    };
  }

  private async namesOf(markers: AnalyticsMarker[]): Promise<Map<number, string>> {
    const ids = [...new Set(markers.map((marker) => marker.releaseId).filter((id) => id !== null))];
    if (ids.length === 0) {
      return new Map();
    }
    const projects = await this.prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, publishedName: true },
    });
    return new Map(projects.map((project) => [project.id, project.publishedName ?? project.name]));
  }
}
