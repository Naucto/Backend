import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ProjectService } from "@project/project.service";

/** Projects whose size is backfilled per cron tick (keeps S3 traffic bounded). */
export const CONTENT_SIZE_BACKFILL_BATCH = 25;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private readonly projectService: ProjectService
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanTimedOutWorkSessions(): Promise<void> {
    await this.prisma.workSession.deleteMany({
      where: {
        lastSaveAt: {
          lt: new Date(Date.now() - 10 * 60 * 1000)
        }
      }
    });
  }

  /**
   * Fills `Project.contentSize` for projects saved before the size budget
   * existed. Runs in small batches until every project has a breakdown.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async backfillProjectContentSizes(): Promise<number> {
    const projectIds = await this.projectService.findProjectsWithoutContentSize(
      CONTENT_SIZE_BACKFILL_BATCH
    );

    let done = 0;
    for (const projectId of projectIds) {
      try {
        await this.projectService.recomputeContentSize(projectId);
        done++;
      } catch (error) {
        this.logger.warn(
          `Could not backfill content size of project ${projectId}: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }

    if (projectIds.length > 0) {
      this.logger.log(
        `Backfilled content size for ${done}/${projectIds.length} projects`
      );
    }

    return done;
  }
}
