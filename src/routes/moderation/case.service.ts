import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  FlagStatus,
  ModerationActionType,
  ModerationReason,
  ModerationTargetType,
  Prisma,
} from '@prisma/client';

import { CodedException } from '../../common/coded.exception';
import { toSkipTake } from '../../common/dto/pagination-query.dto';
import { siteUrls } from '../../common/site-urls';
import { PrismaService } from '../../prisma/prisma.service';
import { allowedOperations } from './allowed-operations';
import {
  CaseDetailDto,
  CaseFlagDto,
  CaseListDto,
  CaseQueryDto,
  CaseSummaryDto,
  CaseTargetDto,
  OpenCaseCountDto,
} from './dto/case.dto';
import { InternalNoteDto } from './dto/moderation-decision.dto';
import { resolveOpenFlags } from './flag-resolution';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationLogService } from './moderation-log.service';
import {
  ACCOUNT_REF_SELECT,
  ACTION_INCLUDE,
  contentOf,
  labelOf,
  toAccountRef,
  toActionDto,
} from './moderation-mappers';
import { ModerationTargetService, TargetView } from './moderation-target.service';
import { StaffActor } from './staff-actor';

const HISTORY_LIMIT = 50;
const OWNER_HISTORY_LIMIT = 10;

/** The flags on one target, counted. Reasons come back as text: Postgres has no array of the enum to hand over. */
interface CaseRow {
  targetType: ModerationTargetType;
  targetId: number;
  targetOwnerId: number | null;
  openFlags: number;
  totalFlags: number;
  openReasons: string[] | null;
  reasons: string[];
  firstFlaggedAt: Date;
  lastFlaggedAt: Date;
}

const HAVING: Record<NonNullable<CaseQueryDto['view']>, Prisma.Sql> = {
  OPEN: Prisma.sql`HAVING COUNT(*) FILTER (WHERE status = 'OPEN') > 0`,
  RESOLVED: Prisma.sql`HAVING COUNT(*) FILTER (WHERE status = 'OPEN') = 0`,
  ALL: Prisma.empty,
};

const ORDER: Record<NonNullable<CaseQueryDto['sort']>, Prisma.Sql> = {
  lastFlagged: Prisma.sql`ORDER BY MAX("createdAt") DESC, "targetType", "targetId"`,
  flags: Prisma.sql`ORDER BY COUNT(*) FILTER (WHERE status = 'OPEN') DESC, MAX("createdAt") DESC, "targetType", "targetId"`,
};

function reasonsOf(row: CaseRow): ModerationReason[] {
  return (row.openFlags > 0 ? (row.openReasons ?? []) : row.reasons) as ModerationReason[];
}

/** The queue staff work through: the flags on one target read as one case. */
@Injectable()
export class CaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targets: ModerationTargetService,
    private readonly log: ModerationLogService,
  ) {}

  async count(): Promise<OpenCaseCountDto> {
    const open = await this.prisma.flag.groupBy({
      by: ['targetType', 'targetId'],
      where: { status: FlagStatus.OPEN },
      _count: { _all: true },
    });
    return {
      openCases: open.length,
      openFlags: open.reduce((sum, group) => sum + group._count._all, 0),
    };
  }

  async list(staff: StaffActor, query: CaseQueryDto): Promise<CaseListDto> {
    const { skip, take } = toSkipTake(query);
    const grouped = this.grouped(query);
    const [rows, [counted]] = await Promise.all([
      this.prisma.$queryRaw<CaseRow[]>`
        ${grouped} ${ORDER[query.sort ?? 'lastFlagged']} LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total FROM (${grouped}) cases`,
    ]);

    return {
      items: await Promise.all(rows.map((row) => this.summary(staff, row))),
      total: counted?.total ?? 0,
      page: query.page ?? 1,
      limit: take,
    };
  }

  async detail(
    staff: StaffActor,
    targetType: ModerationTargetType,
    targetId: number,
  ): Promise<CaseDetailDto> {
    const [row] = await this.prisma.$queryRaw<CaseRow[]>`
      ${this.grouped({ view: 'ALL' }, { targetType, targetId })}`;
    if (!row) {
      throw new NotFoundException('Nothing was ever reported there');
    }

    const view = await this.targets.view(targetType, targetId);
    const ownerId = view.owner?.id ?? row.targetOwnerId;
    const [flags, history, ownerHistory] = await Promise.all([
      this.prisma.flag.findMany({
        where: { targetType, targetId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          reporter: { select: ACCOUNT_REF_SELECT },
          resolvedBy: { select: ACCOUNT_REF_SELECT },
        },
      }),
      this.prisma.moderationAction.findMany({
        where: { targetType, targetId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_LIMIT,
        include: ACTION_INCLUDE,
      }),
      ownerId === null
        ? []
        : this.prisma.moderationAction.findMany({
            where: { subjectUserId: ownerId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: OWNER_HISTORY_LIMIT,
            include: ACTION_INCLUDE,
          }),
    ]);

    const summary = await this.summary(staff, row, view);
    return {
      ...summary,
      current: view.content,
      flags: flags.map(
        (flag): CaseFlagDto => ({
          id: flag.id,
          reporter: toAccountRef(flag.reporter, staff),
          reason: flag.reason,
          details: flag.details,
          snapshot: contentOf(flag.snapshot) ?? { title: null, body: null },
          status: flag.status,
          createdAt: flag.createdAt,
          resolvedAt: flag.resolvedAt,
          resolvedBy: flag.resolvedBy ? toAccountRef(flag.resolvedBy, staff) : null,
        }),
      ),
      history: history.map((action) => toActionDto(action, staff)),
      ownerHistory: ownerHistory.map((action) => toActionDto(action, staff)),
      allowedActions: allowedOperations(staff, {
        type: targetType,
        state: view.state,
        owner: summary.target.owner
          ? {
              id: summary.target.owner.id,
              role: summary.target.owner.role,
              deleted: summary.target.owner.deleted,
              suspended: await this.suspended(summary.target.owner.id),
            }
          : null,
        openFlags: row.openFlags,
      }),
    };
  }

  async dismiss(
    staff: StaffActor,
    targetType: ModerationTargetType,
    targetId: number,
    note: InternalNoteDto,
  ): Promise<CaseDetailDto> {
    const view = await this.targets.view(targetType, targetId);
    const open = await this.prisma.flag.findFirst({
      where: { targetType, targetId, status: FlagStatus.OPEN },
      select: { targetOwnerId: true },
    });
    if (!open) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        MODERATION_ERROR.NO_OPEN_FLAGS,
        'No report is left open on this',
      );
    }
    const ownerId = view.owner?.id ?? open.targetOwnerId;
    if (ownerId === staff.id) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        MODERATION_ERROR.OWN_CASE,
        'You cannot settle a case about your own content',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const recorded = await this.log.record(tx, {
        action: ModerationActionType.FLAGS_DISMISSED,
        actorId: staff.id,
        targetType,
        targetId,
        subjectUserId: ownerId ?? undefined,
        internalNote: note.internalNote,
        snapshot: view.content ?? undefined,
      });
      await resolveOpenFlags(tx, {
        targetType,
        targetId,
        status: FlagStatus.DISMISSED,
        resolvedById: staff.id,
        resolutionId: recorded.id,
      });
    });

    return this.detail(staff, targetType, targetId);
  }

  /** Every target that was flagged, with its flags counted, narrowed as asked. */
  private grouped(
    query: Pick<CaseQueryDto, 'view' | 'targetType' | 'reason'>,
    only?: { targetType: ModerationTargetType; targetId: number },
  ): Prisma.Sql {
    const targetType = only?.targetType ?? query.targetType;
    const filters = [
      targetType
        ? Prisma.sql`"targetType" = ${targetType}::"ModerationTargetType"`
        : Prisma.sql`TRUE`,
      only ? Prisma.sql`"targetId" = ${only.targetId}` : Prisma.sql`TRUE`,
      query.reason ? Prisma.sql`"reason" = ${query.reason}::"ModerationReason"` : Prisma.sql`TRUE`,
    ];
    return Prisma.sql`
      SELECT
        "targetType",
        "targetId",
        MAX("targetOwnerId") AS "targetOwnerId",
        COUNT(*) FILTER (WHERE status = 'OPEN')::int AS "openFlags",
        COUNT(*)::int AS "totalFlags",
        ARRAY_AGG(DISTINCT "reason"::text) FILTER (WHERE status = 'OPEN') AS "openReasons",
        ARRAY_AGG(DISTINCT "reason"::text) AS "reasons",
        MIN("createdAt") AS "firstFlaggedAt",
        MAX("createdAt") AS "lastFlaggedAt"
      FROM "Flag"
      WHERE ${Prisma.join(filters, ' AND ')}
      GROUP BY "targetType", "targetId"
      ${HAVING[query.view ?? 'OPEN']}`;
  }

  private async summary(
    staff: StaffActor,
    row: CaseRow,
    known?: TargetView,
  ): Promise<CaseSummaryDto> {
    const view = known ?? (await this.targets.view(row.targetType, row.targetId));
    return {
      target: await this.target(staff, row, view),
      status: row.openFlags > 0 ? 'OPEN' : 'RESOLVED',
      openFlags: row.openFlags,
      totalFlags: row.totalFlags,
      reasons: reasonsOf(row),
      firstFlaggedAt: row.firstFlaggedAt,
      lastFlaggedAt: row.lastFlaggedAt,
    };
  }

  /** A target that is gone is still named, from what its flags kept of it. */
  private async target(staff: StaffActor, row: CaseRow, view: TargetView): Promise<CaseTargetDto> {
    let owner = view.owner;
    let label = labelOf(view.content);
    if (view.state === 'GONE') {
      const [lastFlag, lastOwner] = await Promise.all([
        this.prisma.flag.findFirst({
          where: { targetType: row.targetType, targetId: row.targetId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { snapshot: true },
        }),
        row.targetOwnerId === null
          ? null
          : this.prisma.user.findUnique({
              where: { id: row.targetOwnerId },
              select: ACCOUNT_REF_SELECT,
            }),
      ]);
      owner = lastOwner;
      label = labelOf(contentOf(lastFlag?.snapshot ?? null));
    }

    const game = view.project;
    return {
      type: row.targetType,
      id: row.targetId,
      state: view.state,
      label,
      owner: owner ? toAccountRef(owner, staff) : null,
      projectId: game?.id ?? null,
      projectName: game?.name ?? null,
      playUrl: game?.reachable ? siteUrls.play(game.id) : null,
      previewPlayUrl: game ? siteUrls.previewPlay(game.id) : null,
      previewEditUrl: game ? siteUrls.previewEdit(game.id) : null,
    };
  }

  private async suspended(accountId: number): Promise<boolean> {
    const view = await this.targets.view(ModerationTargetType.USER, accountId);
    return view.state === 'SUSPENDED';
  }
}
