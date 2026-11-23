import { Injectable, Logger } from '@nestjs/common';
import { ModerationActionType, ModerationTargetType } from '@prisma/client';

import { hubName } from '../project/hub-fields';
import { ProjectService } from '../project/project.service';
import { ProjectContentService } from '../project/project-content.service';
import { ProjectEx } from '../project/project-select';
import { DownloadedFile } from '../s3/s3.interface';
import { PreviewSource, ProjectPreviewDto } from './dto/project-preview.dto';
import { ModerationLogService } from './moderation-log.service';
import { StaffActor } from './staff-actor';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Staff reading a game they do not collaborate on. Everything here reads: nothing is saved, no
 * view is counted and no work session is opened, so the author's game and its numbers are exactly
 * as they were. What is left behind is one log row saying who looked.
 */
@Injectable()
export class StaffPreviewService {
  private readonly logger = new Logger(StaffPreviewService.name);

  constructor(
    private readonly projects: ProjectService,
    private readonly stored: ProjectContentService,
    private readonly log: ModerationLogService,
  ) {}

  /** The game as its own collaborators read it, draft fields and all. */
  async preview(staff: StaffActor, projectId: string): Promise<ProjectPreviewDto> {
    const project = await this.projects.findOne(projectId);
    await this.noteViewed(staff, project);
    return { ...project, hasRelease: project.publishedAt !== null };
  }

  /** Null when the game holds nothing for that source yet. */
  async content(
    staff: StaffActor,
    projectId: string,
    source: PreviewSource,
  ): Promise<DownloadedFile | null> {
    const project = await this.projects.findOne(projectId);
    await this.noteViewed(staff, project);

    if (source === 'release') {
      return this.stored.fetchReleaseForReview(projectId);
    }
    const draft = await this.stored.fetchLastVersion(projectId);
    return draft.contentLength === 0 ? null : draft;
  }

  /**
   * One row per staff member, game and hour: opening the editor asks for the game several times,
   * and a reload is not a second look. A failure to note it is logged and does not refuse the
   * preview, which staff may need during the very outage that broke the log.
   */
  private async noteViewed(staff: StaffActor, project: ProjectEx): Promise<void> {
    const hour = Math.floor(Date.now() / HOUR_MS);
    try {
      await this.log.recordOnce(
        {
          action: ModerationActionType.DRAFT_VIEWED,
          actorId: staff.id,
          targetType: ModerationTargetType.PROJECT,
          targetId: project.id,
          subjectUserId: project.userId,
          snapshot: { title: hubName(project), body: null },
        },
        `view:${staff.id}:${project.id}:${String(hour)}`,
      );
    } catch (error) {
      this.logger.error(
        `Could not note that staff ${staff.id} previewed game ${project.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
