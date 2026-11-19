import { Injectable } from '@nestjs/common';

import { DownloadedFile } from '../s3/s3.interface';
import {
  AccountDirectoryQueryDto,
  CommentDirectoryQueryDto,
  ModerationAccountDetailDto,
  ModerationAccountListDto,
  ModerationCommentListDto,
  ModerationProjectDetailDto,
  ModerationProjectListDto,
  ProjectDirectoryQueryDto,
} from './dto/directory.dto';
import { notAvailableYet } from './moderation.error';
import { StaffActor } from './staff-actor';

/** Every account, game and comment as staff look them up, whatever players can see of them. */
@Injectable()
export class ModerationDirectoryService {
  accounts(
    _staff: StaffActor,
    _query: AccountDirectoryQueryDto,
  ): Promise<ModerationAccountListDto> {
    return notAvailableYet();
  }

  account(_staff: StaffActor, _accountId: number): Promise<ModerationAccountDetailDto> {
    return notAvailableYet();
  }

  projects(
    _staff: StaffActor,
    _query: ProjectDirectoryQueryDto,
  ): Promise<ModerationProjectListDto> {
    return notAvailableYet();
  }

  project(_staff: StaffActor, _projectId: number): Promise<ModerationProjectDetailDto> {
    return notAvailableYet();
  }

  /** The cover of a game, from wherever it is kept while the game is withheld. */
  projectCover(_projectId: number): Promise<DownloadedFile> {
    return notAvailableYet();
  }

  comments(
    _staff: StaffActor,
    _query: CommentDirectoryQueryDto,
  ): Promise<ModerationCommentListDto> {
    return notAvailableYet();
  }
}
