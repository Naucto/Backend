import { Injectable } from '@nestjs/common';

import { DownloadedFile } from '../s3/s3.interface';
import { PreviewSource, ProjectPreviewDto } from './dto/project-preview.dto';
import { notAvailableYet } from './moderation.error';
import { StaffActor } from './staff-actor';

/** Staff reading a game they do not collaborate on, without writing to it or counting as a player. */
@Injectable()
export class StaffPreviewService {
  preview(_staff: StaffActor, _projectId: number): Promise<ProjectPreviewDto> {
    return notAvailableYet();
  }

  /** Null when the game holds nothing for that source yet. */
  content(
    _staff: StaffActor,
    _projectId: number,
    _source: PreviewSource,
  ): Promise<DownloadedFile | null> {
    return notAvailableYet();
  }
}
