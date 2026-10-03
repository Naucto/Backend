import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { ProjectContentService } from '../../routes/project/project-content.service';

/**
 * A work session nobody has saved into for this long is presumed abandoned. The sweep only runs
 * on its schedule, so a session may outlive its last save by up to one interval more.
 */
export const WORK_SESSION_TIMEOUT_MS = 10 * 60 * 1000;

/** Projects whose size is backfilled per cron tick (keeps S3 traffic bounded). */
const CONTENT_SIZE_BACKFILL_BATCH = 25;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private readonly contentService: ProjectContentService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanTimedOutWorkSessions(): Promise<void> {
    await this.prisma.workSession.deleteMany({
      where: {
        lastSaveAt: {
          lt: new Date(Date.now() - WORK_SESSION_TIMEOUT_MS),
        },
      },
    });
  }

  /**
   * Fills `Project.contentSize` for projects saved before the size budget
   * existed. Runs in small batches until every project has a breakdown.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async backfillProjectContentSizes(): Promise<number> {
    const projectIds = await this.contentService.findProjectsWithoutContentSize(
      CONTENT_SIZE_BACKFILL_BATCH,
    );

    let done = 0;
    for (const projectId of projectIds) {
      try {
        await this.contentService.recomputeContentSize(projectId);
        done++;
      } catch (error) {
        this.logger.warn(
          `Could not backfill content size of project ${projectId}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    if (projectIds.length > 0) {
      this.logger.log(`Backfilled content size for ${done}/${projectIds.length} projects`);
    }

    return done;
  }
}
