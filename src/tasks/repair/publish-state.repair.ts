import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { projectKeys } from '../../routes/project/project-keys';
import { PUBLISHED } from '../../routes/project/project-select';
import { S3Service } from '../../routes/s3/s3.service';

/**
 * Resets rows that claim a release whose object is missing from storage; idempotent, since a
 * repaired row stops matching.
 */
@Injectable()
export class PublishStateRepair {
  private readonly logger = new Logger(PublishStateRepair.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async run(): Promise<number[]> {
    const claimed = await this.prisma.project.findMany({
      // A game moderation withholds has its release moved out of public reach on purpose.
      where: PUBLISHED,
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const repaired: number[] = [];

    for (const { id } of claimed) {
      const release = projectKeys.release(id);
      if (await this.s3.fileExists(release)) {
        continue;
      }
      this.logger.warn(
        `Project ${id}: publishedAt set but ${release} is missing, resetting to unpublished`,
      );
      repaired.push(id);
    }

    if (repaired.length > 0) {
      await this.prisma.project.updateMany({
        where: { id: { in: repaired } },
        data: { publishedAt: null, status: 'IN_PROGRESS' },
      });
    }

    this.logger.log(`Checked ${claimed.length} published rows, repaired ${repaired.length}`);

    await this.unserveWithheld();

    return repaired;
  }

  /**
   * Hiding a game marks its row before it removes what the edge serves, so a failure between the
   * two leaves a withheld game still downloadable. This finishes the removal.
   */
  private async unserveWithheld(): Promise<void> {
    const hidden = await this.prisma.project.findMany({
      where: { hiddenAt: { not: null } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    for (const { id } of hidden) {
      for (const key of [projectKeys.release(id), projectKeys.cover(id)]) {
        if (await this.s3.fileExists(key)) {
          this.logger.warn(`Project ${id} is hidden but ${key} was still served, removing it`);
          await this.s3.deleteFile({ key });
        }
      }
    }
  }
}
