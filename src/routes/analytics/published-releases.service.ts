import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 60_000;
/** Ids remembered as unpublished at most; a flood of invented ids cannot grow memory past this. */
const NEGATIVE_CAPACITY = 10_000;

/**
 * Whether a release id names a published game, so analytics never keeps a row per invented id.
 * A cache miss asks the database, so a game published a moment ago is never refused.
 */
@Injectable()
export class PublishedReleasesService {
  private published = new Set<number>();
  private publishedLoadedAt = Number.NEGATIVE_INFINITY;
  private readonly unpublishedUntil = new Map<number, number>();

  constructor(private readonly prisma: PrismaService) {}

  async isPublished(releaseId: number, now = Date.now()): Promise<boolean> {
    if (now - this.publishedLoadedAt > POSITIVE_TTL_MS) {
      await this.reload(now);
    }
    if (this.published.has(releaseId)) {
      return true;
    }
    const until = this.unpublishedUntil.get(releaseId);
    if (until !== undefined && until > now) {
      return false;
    }

    const found = await this.prisma.project.findFirst({
      where: { id: releaseId, publishedAt: { not: null } },
      select: { id: true },
    });
    if (found) {
      this.published.add(releaseId);
      this.unpublishedUntil.delete(releaseId);
      return true;
    }
    if (this.unpublishedUntil.size >= NEGATIVE_CAPACITY) {
      this.unpublishedUntil.clear();
    }
    this.unpublishedUntil.set(releaseId, now + NEGATIVE_TTL_MS);
    return false;
  }

  private async reload(now: number): Promise<void> {
    const rows = await this.prisma.project.findMany({
      where: { publishedAt: { not: null } },
      select: { id: true },
    });
    this.published = new Set(rows.map((row) => row.id));
    this.publishedLoadedAt = now;
  }
}
