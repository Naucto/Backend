import { Injectable, NotFoundException } from '@nestjs/common';
import { FlagStatus, ModerationActionType, ModerationTargetType, Prisma } from '@prisma/client';

import { ADMIN, holdsRole } from '../../auth/access/roles';
import { currentSuspension } from '../../auth/access/suspension';
import { toSkipTake } from '../../common/dto/pagination-query.dto';
import { siteUrls } from '../../common/site-urls';
import { PrismaService } from '../../prisma/prisma.service';
import { hubName } from '../project/hub-fields';
import { projectKeys } from '../project/project-keys';
import { PUBLISHED } from '../project/project-select';
import { DownloadedFile } from '../s3/s3.interface';
import { S3Service } from '../s3/s3.service';
import { allowedOperations } from './allowed-operations';
import { TargetState } from './dto/case.dto';
import {
  AccountDirectoryQueryDto,
  AccountStanding,
  CommentDirectoryQueryDto,
  CommentModerationState,
  ModerationAccountDetailDto,
  ModerationAccountDto,
  ModerationAccountListDto,
  ModerationCommentDto,
  ModerationCommentListDto,
  ModerationProjectDetailDto,
  ModerationProjectDto,
  ModerationProjectListDto,
  ProjectDirectoryQueryDto,
  ProjectModerationState,
} from './dto/directory.dto';
import { ACCOUNT_REF_SELECT, toAccountRef } from './moderation-mappers';
import { StaffActor } from './staff-actor';

const SUSPENSION_COLUMNS = { suspendedAt: true, suspendedUntil: true } as const;

const ACCOUNT_SELECT = {
  ...ACCOUNT_REF_SELECT,
  ...SUSPENSION_COLUMNS,
  createdAt: true,
  description: true,
  _count: { select: { creator: true, comments: true, flagsFiled: true } },
} satisfies Prisma.UserSelect;

type AccountRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

const OWNER_SELECT = { ...ACCOUNT_REF_SELECT, ...SUSPENSION_COLUMNS } as const;

const PROJECT_SELECT = {
  id: true,
  name: true,
  shortDesc: true,
  longDesc: true,
  tags: true,
  publishedName: true,
  publishedShortDesc: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  hiddenAt: true,
  forkedFromId: true,
  creator: { select: OWNER_SELECT },
} satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

const COMMENT_SELECT = {
  id: true,
  content: true,
  deleted: true,
  hiddenAt: true,
  createdAt: true,
  parentId: true,
  author: { select: OWNER_SELECT },
  project: {
    select: { id: true, name: true, publishedName: true, publishedAt: true, hiddenAt: true },
  },
} satisfies Prisma.CommentSelect;

type CommentRow = Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>;

type Owner = Prisma.UserGetPayload<{ select: typeof OWNER_SELECT }>;

/** A suspension that still holds: one with no end date, or one whose end date is ahead. */
function suspendedNow(now: Date): Prisma.UserWhereInput {
  return {
    suspendedAt: { not: null },
    OR: [{ suspendedUntil: null }, { suspendedUntil: { gt: now } }],
  };
}

const WARNED: Prisma.UserWhereInput = {
  moderationRecord: { some: { action: ModerationActionType.ACCOUNT_WARNED } },
};

const PROJECT_STATES: Record<ProjectModerationState, Prisma.ProjectWhereInput> = {
  PUBLISHED,
  UNPUBLISHED: { publishedAt: null, hiddenAt: null },
  HIDDEN: { hiddenAt: { not: null } },
};

const COMMENT_STATES: Record<CommentModerationState, Prisma.CommentWhereInput> = {
  VISIBLE: { deleted: false, hiddenAt: null },
  HIDDEN: { hiddenAt: { not: null } },
  DELETED: { deleted: true, hiddenAt: null },
};

function projectState(
  project: Pick<ProjectRow, 'publishedAt' | 'hiddenAt'>,
): ProjectModerationState {
  return project.hiddenAt ? 'HIDDEN' : project.publishedAt ? 'PUBLISHED' : 'UNPUBLISHED';
}

function commentState(comment: Pick<CommentRow, 'deleted' | 'hiddenAt'>): CommentModerationState {
  return comment.hiddenAt ? 'HIDDEN' : comment.deleted ? 'DELETED' : 'VISIBLE';
}

function operationOwner(owner: Owner): {
  id: string;
  role: string;
  deleted: boolean;
  suspended: boolean;
} {
  return {
    id: owner.id,
    role: owner.role,
    deleted: owner.deletedAt !== null,
    suspended: currentSuspension(owner) !== null,
  };
}

/** Every account, game and comment as staff look them up, whatever players can see of them. */
@Injectable()
export class ModerationDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async accounts(
    staff: StaffActor,
    query: AccountDirectoryQueryDto,
  ): Promise<ModerationAccountListDto> {
    const { skip, take } = toSkipTake(query);
    const now = new Date();
    const contains = { contains: query.search ?? '', mode: 'insensitive' } as const;
    const standing: Record<AccountStanding, Prisma.UserWhereInput> = {
      SUSPENDED: suspendedNow(now),
      WARNED: { AND: [WARNED, { NOT: suspendedNow(now) }] },
      GOOD: { NOT: { OR: [WARNED, suspendedNow(now)] } },
    };
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role ? { role: query.role } : {}),
      AND: [
        query.standing ? standing[query.standing] : {},
        query.search
          ? {
              OR: [
                { username: contains },
                { nickname: contains },
                // An address is searched only by who may read it back.
                ...(holdsRole(staff.role, ADMIN) ? [{ email: contains }] : []),
              ],
            }
          : {},
      ],
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: ACCOUNT_SELECT,
      }),
    ]);
    const ids = rows.map((row) => row.id);
    const [warnings, openFlags] = await Promise.all([this.warnings(ids), this.flagsAbout(ids)]);

    return {
      items: rows.map((row) =>
        this.accountDto(staff, row, warnings.get(row.id) ?? 0, openFlags.get(row.id) ?? 0),
      ),
      total,
      page: query.page ?? 1,
      limit: take,
    };
  }

  async account(staff: StaffActor, accountId: string): Promise<ModerationAccountDetailDto> {
    const row = await this.prisma.user.findUnique({
      where: { id: accountId },
      select: ACCOUNT_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Account not found');
    }
    const [warnings, openFlags, onProfile] = await Promise.all([
      this.warnings([row.id]),
      this.flagsAbout([row.id]),
      this.openFlags(ModerationTargetType.USER, [row.id]),
    ]);
    const summary = this.accountDto(
      staff,
      row,
      warnings.get(row.id) ?? 0,
      openFlags.get(row.id) ?? 0,
    );

    return {
      ...summary,
      description: row.description,
      allowedActions: allowedOperations(staff, {
        type: ModerationTargetType.USER,
        state: summary.deleted ? 'DELETED' : summary.suspension ? 'SUSPENDED' : 'VISIBLE',
        owner: operationOwner(row),
        openFlags: onProfile.get(row.id) ?? 0,
      }),
    };
  }

  async projects(
    staff: StaffActor,
    query: ProjectDirectoryQueryDto,
  ): Promise<ModerationProjectListDto> {
    const { skip, take } = toSkipTake(query);
    const contains = { contains: query.search ?? '', mode: 'insensitive' } as const;
    const where: Prisma.ProjectWhereInput = {
      ...(query.creatorId ? { userId: query.creatorId } : {}),
      AND: [
        query.state ? PROJECT_STATES[query.state] : {},
        query.search ? { OR: [{ name: contains }, { publishedName: contains }] } : {},
      ],
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: PROJECT_SELECT,
      }),
    ]);
    const openFlags = await this.openFlags(
      ModerationTargetType.PROJECT,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) => this.projectDto(staff, row, openFlags.get(row.id) ?? 0)),
      total,
      page: query.page ?? 1,
      limit: take,
    };
  }

  async project(staff: StaffActor, projectId: string): Promise<ModerationProjectDetailDto> {
    const row = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        ...PROJECT_SELECT,
        collaborators: { select: ACCOUNT_REF_SELECT },
      },
    });
    if (!row) {
      throw new NotFoundException('Game not found');
    }
    const openFlags = (await this.openFlags(ModerationTargetType.PROJECT, [row.id])).get(row.id);
    const state = projectState(row);
    const targetState: Record<ProjectModerationState, TargetState> = {
      PUBLISHED: 'VISIBLE',
      UNPUBLISHED: 'UNPUBLISHED',
      HIDDEN: 'HIDDEN',
    };

    return {
      ...this.projectDto(staff, row, openFlags ?? 0),
      longDesc: row.longDesc,
      tags: row.tags,
      collaborators: row.collaborators.map((collaborator) => toAccountRef(collaborator, staff)),
      forkedFromId: row.forkedFromId,
      hasCover: (await this.coverKey(row.id)) !== null,
      allowedActions: allowedOperations(staff, {
        type: ModerationTargetType.PROJECT,
        state: targetState[state],
        owner: operationOwner(row.creator),
        openFlags: openFlags ?? 0,
      }),
    };
  }

  /** The cover of a game, from wherever it is kept while the game is withheld. */
  async projectCover(projectId: string): Promise<DownloadedFile> {
    const key = await this.coverKey(projectId);
    if (!key) {
      throw new NotFoundException('This game has no cover');
    }
    return this.s3Service.downloadFile({ key });
  }

  async comments(
    staff: StaffActor,
    query: CommentDirectoryQueryDto,
  ): Promise<ModerationCommentListDto> {
    const { skip, take } = toSkipTake(query);
    const where: Prisma.CommentWhereInput = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.authorId ? { authorId: query.authorId } : {}),
      ...(query.search ? { content: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.state ? COMMENT_STATES[query.state] : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.comment.count({ where }),
      this.prisma.comment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: COMMENT_SELECT,
      }),
    ]);
    const openFlags = await this.openFlags(
      ModerationTargetType.COMMENT,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) => this.commentDto(staff, row, openFlags.get(row.id) ?? 0)),
      total,
      page: query.page ?? 1,
      limit: take,
    };
  }

  private accountDto(
    staff: StaffActor,
    row: AccountRow,
    warnings: number,
    openFlags: number,
  ): ModerationAccountDto {
    const suspension = currentSuspension(row);
    return {
      ...toAccountRef(row, staff),
      createdAt: row.createdAt,
      standing: suspension ? 'SUSPENDED' : warnings > 0 ? 'WARNED' : 'GOOD',
      suspension,
      warnings,
      games: row._count.creator,
      comments: row._count.comments,
      openFlags,
      flagsFiled: row._count.flagsFiled,
    };
  }

  private projectDto(staff: StaffActor, row: ProjectRow, openFlags: number): ModerationProjectDto {
    const state = projectState(row);
    return {
      id: row.id,
      name: hubName(row),
      shortDesc: row.publishedShortDesc || row.shortDesc,
      owner: toAccountRef(row.creator, staff),
      state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      publishedAt: row.publishedAt,
      hiddenAt: row.hiddenAt,
      openFlags,
      playUrl: state === 'PUBLISHED' ? siteUrls.play(row.id) : null,
      previewPlayUrl: siteUrls.previewPlay(row.id),
      previewEditUrl: siteUrls.previewEdit(row.id),
    };
  }

  private commentDto(staff: StaffActor, row: CommentRow, openFlags: number): ModerationCommentDto {
    const state = commentState(row);
    const reachable = row.project.publishedAt !== null && row.project.hiddenAt === null;
    return {
      id: row.id,
      content: row.content,
      author: toAccountRef(row.author, staff),
      projectId: row.project.id,
      projectName: hubName(row.project),
      parentId: row.parentId,
      state,
      createdAt: row.createdAt,
      hiddenAt: row.hiddenAt,
      openFlags,
      playUrl: reachable ? siteUrls.play(row.project.id) : null,
      allowedActions: allowedOperations(staff, {
        type: ModerationTargetType.COMMENT,
        state,
        owner: operationOwner(row.author),
        openFlags,
      }),
    };
  }

  private async coverKey(projectId: string): Promise<string | null> {
    for (const key of [projectKeys.cover(projectId), projectKeys.withheldCover(projectId)]) {
      if (await this.s3Service.fileExists(key)) {
        return key;
      }
    }
    return null;
  }

  /** Open flags per target of one kind. */
  private async openFlags(type: ModerationTargetType, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) {
      return new Map();
    }
    const groups = await this.prisma.flag.groupBy({
      by: ['targetId'],
      where: { targetType: type, targetId: { in: ids }, status: FlagStatus.OPEN },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.targetId, group._count._all]));
  }

  /** Open flags per account, on its profile and on everything it wrote or made. */
  private async flagsAbout(accountIds: string[]): Promise<Map<string, number>> {
    if (accountIds.length === 0) {
      return new Map();
    }
    const groups = await this.prisma.flag.groupBy({
      by: ['targetOwnerId'],
      where: { targetOwnerId: { in: accountIds }, status: FlagStatus.OPEN },
      _count: { _all: true },
    });
    return new Map(
      groups.flatMap((group) =>
        group.targetOwnerId === null ? [] : [[group.targetOwnerId, group._count._all] as const],
      ),
    );
  }

  private async warnings(accountIds: string[]): Promise<Map<string, number>> {
    if (accountIds.length === 0) {
      return new Map();
    }
    const groups = await this.prisma.moderationAction.groupBy({
      by: ['subjectUserId'],
      where: { subjectUserId: { in: accountIds }, action: ModerationActionType.ACCOUNT_WARNED },
      _count: { _all: true },
    });
    return new Map(
      groups.flatMap((group) =>
        group.subjectUserId === null ? [] : [[group.subjectUserId, group._count._all] as const],
      ),
    );
  }
}
