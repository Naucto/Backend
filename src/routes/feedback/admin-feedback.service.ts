import { Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsGrain, BugStatus, Prisma } from '@prisma/client';

import { toSkipTake } from '../../common/dto/pagination-query.dto';
import { getOptionalEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ADMIN_ACCOUNT_SELECT,
  AdminAccountRow,
  toAccountSummary,
} from '../admin/admin-session.service';
import { periodOf } from '../analytics/analytics-periods';
import { DAY_MS } from '../analytics/analytics-time';
import { hubName } from '../project/hub-fields';
import { S3ObjectNotFoundException } from '../s3/s3.error';
import { DownloadedFile } from '../s3/s3.interface';
import { S3Service } from '../s3/s3.service';
import {
  AdminBugDetailDto,
  AdminBugListDto,
  AdminBugQueryDto,
  AdminBugSummaryDto,
  AdminCrashDetailDto,
  AdminCrashGroupDto,
  AdminCrashListDto,
  AdminCrashQueryDto,
  AdminRatingDto,
  AdminRatingListDto,
  AdminRatingQueryDto,
  BugView,
  FeedbackAccountDto,
  FeedbackReleaseDto,
  RatingAverageDto,
  RatingSummaryDto,
  RatingSummaryQueryDto,
  UpdateBugReportDto,
  UpdateCrashGroupDto,
} from './dto/admin-feedback.dto';
import { RATING_MAX } from './dto/feedback.dto';

const LOW_SCORE_MAX = 4;
const LIST_PAGE_SIZE = 20;

const BUG_VIEW_STATUSES: Record<BugView, BugStatus[] | null> = {
  NEW: ['NEW'],
  OPEN: ['NEW', 'TRIAGED', 'IN_PROGRESS'],
  CLOSED: ['RESOLVED', 'WONT_FIX', 'DUPLICATE'],
  ALL: null,
};

const CRASH_GROUP_SELECT = {
  id: true,
  fingerprint: true,
  source: true,
  name: true,
  message: true,
  count: true,
  firstSeen: true,
  lastSeen: true,
  lastRelease: true,
  status: true,
  regressedAt: true,
} as const;

const dayStart = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** `[from, to]` as a half-open window of instants; `to` is a whole day, included. */
function dayRange(from: string | undefined, to: string | undefined): Prisma.DateTimeFilter | null {
  if (!from && !to) {
    return null;
  }
  return {
    ...(from ? { gte: dayStart(from) } : {}),
    ...(to ? { lt: new Date(dayStart(to).getTime() + DAY_MS) } : {}),
  };
}

function averageOf(scores: number[]): RatingAverageDto {
  if (scores.length === 0) {
    return { count: 0, average: null };
  }
  const total = scores.reduce((sum, score) => sum + score, 0);
  return { count: scores.length, average: Math.round((total / scores.length) * 100) / 100 };
}

/** What the admin console reads of feedback and crashes, and the triage it writes back. */
@Injectable()
export class AdminFeedbackService {
  private readonly frontendUrl = getOptionalEnv('FRONTEND_URL', 'http://localhost:3001').replace(
    /\/+$/,
    '',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async ratings(query: AdminRatingQueryDto): Promise<AdminRatingListDto> {
    const { skip, take } = toSkipTake(query, LIST_PAGE_SIZE);
    const createdAt = dayRange(query.from, query.to);
    const where: Prisma.PlatformRatingWhereInput = {
      ...(query.context ? { context: query.context } : {}),
      ...(query.maxScore ? { score: { lte: query.maxScore } } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(query.withComments ? { OR: [{ liked: { not: null } }, { improve: { not: null } }] } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.platformRating.count({ where }),
      this.prisma.platformRating.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: {
          user: { select: ADMIN_ACCOUNT_SELECT },
          bugReports: { select: { id: true }, orderBy: { id: 'asc' } },
        },
      }),
    ]);
    const releases = await this.releases(rows.map((row) => row.releaseId));

    const items: AdminRatingDto[] = rows.map((row) => ({
      id: row.id,
      score: row.score,
      reasons: row.reasons,
      liked: row.liked,
      improve: row.improve,
      context: row.context,
      source: row.source,
      appRelease: row.appRelease,
      createdAt: row.createdAt,
      account: this.account(row.user),
      release: row.releaseId ? (releases.get(row.releaseId) ?? null) : null,
      bugReportIds: row.bugReports.map((report) => report.id),
    }));
    return { items, total, page: query.page ?? 1, limit: take };
  }

  async ratingSummary(query: RatingSummaryQueryDto): Promise<RatingSummaryDto> {
    const createdAt = dayRange(query.from, query.to) ?? {};
    const rows = await this.prisma.platformRating.findMany({
      where: { createdAt },
      select: { score: true, context: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const scores = rows.map((row) => row.score);
    const distribution = Array.from(
      { length: RATING_MAX },
      (_, index) => scores.filter((score) => score === index + 1).length,
    );
    const low = scores.filter((score) => score <= LOW_SCORE_MAX).length;

    return {
      ...averageOf(scores),
      lowShare: scores.length === 0 ? null : Math.round((low / scores.length) * 1000) / 1000,
      distribution,
      player: averageOf(rows.filter((row) => row.context === 'PLAYER').map((row) => row.score)),
      creator: averageOf(rows.filter((row) => row.context === 'CREATOR').map((row) => row.score)),
      series: this.series(rows, query.from, query.to, query.grain),
    };
  }

  async bugs(query: AdminBugQueryDto): Promise<AdminBugListDto> {
    const { skip, take } = toSkipTake(query, LIST_PAGE_SIZE);
    const statuses = BUG_VIEW_STATUSES[query.view ?? 'OPEN'];
    const where: Prisma.BugReportWhereInput = {
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(query.category ? { category: query.category } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.bugReport.count({ where }),
      this.prisma.bugReport.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: { user: { select: ADMIN_ACCOUNT_SELECT } },
      }),
    ]);
    const releases = await this.releases(rows.map((row) => row.releaseId));

    const items: AdminBugSummaryDto[] = rows.map((row) => this.bugSummary(row, releases));
    return { items, total, page: query.page ?? 1, limit: take };
  }

  async newBugCount(): Promise<number> {
    return this.prisma.bugReport.count({ where: { status: 'NEW' } });
  }

  async bug(id: number): Promise<AdminBugDetailDto> {
    const row = await this.prisma.bugReport.findUnique({
      where: { id },
      include: {
        user: { select: ADMIN_ACCOUNT_SELECT },
        rating: { select: { id: true, score: true, liked: true, improve: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Bug report not found');
    }
    const releases = await this.releases([row.releaseId]);

    return {
      ...this.bugSummary(row, releases),
      description: row.description,
      route: row.route,
      projectId: row.projectId,
      context:
        typeof row.context === 'object' && row.context !== null && !Array.isArray(row.context)
          ? (row.context as Record<string, unknown>)
          : {},
      adminNote: row.adminNote,
      rating: row.rating,
      screenshot:
        row.screenshotKey && row.screenshotMime
          ? { mime: row.screenshotMime, bytes: row.screenshotBytes ?? 0 }
          : null,
    };
  }

  async updateBug(id: number, dto: UpdateBugReportDto): Promise<AdminBugDetailDto> {
    const updated = await this.prisma.bugReport.updateMany({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.adminNote !== undefined ? { adminNote: dto.adminNote?.trim() || null } : {}),
      },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Bug report not found');
    }
    return this.bug(id);
  }

  async screenshot(id: number): Promise<DownloadedFile> {
    const row = await this.prisma.bugReport.findUnique({
      where: { id },
      select: { screenshotKey: true },
    });
    if (!row?.screenshotKey) {
      throw new NotFoundException('No screenshot');
    }
    try {
      return await this.s3Service.downloadFile({ key: row.screenshotKey });
    } catch (error) {
      if (error instanceof S3ObjectNotFoundException) {
        throw new NotFoundException('No screenshot');
      }
      throw error;
    }
  }

  async crashes(query: AdminCrashQueryDto): Promise<AdminCrashListDto> {
    const { skip, take } = toSkipTake(query, LIST_PAGE_SIZE);
    const where: Prisma.CrashGroupWhereInput = {
      ...(query.source ? { source: query.source } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const orderBy: Prisma.CrashGroupOrderByWithRelationInput[] =
      query.sort === 'count'
        ? [{ count: 'desc' }, { lastSeen: 'desc' }]
        : [{ lastSeen: 'desc' }, { id: 'desc' }];

    const [total, items] = await this.prisma.$transaction([
      this.prisma.crashGroup.count({ where }),
      this.prisma.crashGroup.findMany({
        where,
        orderBy,
        skip,
        take,
        select: CRASH_GROUP_SELECT,
      }),
    ]);
    return { items, total, page: query.page ?? 1, limit: take };
  }

  async crash(id: number): Promise<AdminCrashDetailDto> {
    const row = await this.prisma.crashGroup.findUnique({
      where: { id },
      select: {
        ...CRASH_GROUP_SELECT,
        lastStack: true,
        events: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            createdAt: true,
            route: true,
            appRelease: true,
            device: true,
            browser: true,
            os: true,
            extra: true,
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException('Crash not found');
    }
    return {
      ...row,
      events: row.events.map((event) => ({
        ...event,
        extra:
          typeof event.extra === 'object' && event.extra !== null && !Array.isArray(event.extra)
            ? (event.extra as Record<string, unknown>)
            : null,
      })),
    };
  }

  async updateCrash(id: number, dto: UpdateCrashGroupDto): Promise<AdminCrashGroupDto> {
    const updated = await this.prisma.crashGroup.updateMany({
      where: { id },
      data: { status: dto.status, ...(dto.status !== 'OPEN' ? { regressedAt: null } : {}) },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Crash not found');
    }
    return this.prisma.crashGroup.findUniqueOrThrow({
      where: { id },
      select: CRASH_GROUP_SELECT,
    });
  }

  private account(row: AdminAccountRow): FeedbackAccountDto {
    const deleted = row.deletedAt !== null;
    return {
      ...toAccountSummary(row),
      deleted,
      profileUrl: deleted ? null : `${this.frontendUrl}/u/${encodeURIComponent(row.username)}`,
    };
  }

  private bugSummary(
    row: {
      id: number;
      title: string;
      category: AdminBugSummaryDto['category'];
      status: BugStatus;
      createdAt: Date;
      updatedAt: Date;
      releaseId: number | null;
      screenshotKey: string | null;
      user: AdminAccountRow;
    },
    releases: Map<number, FeedbackReleaseDto>,
  ): AdminBugSummaryDto {
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      account: this.account(row.user),
      release: row.releaseId ? (releases.get(row.releaseId) ?? null) : null,
      hasScreenshot: row.screenshotKey !== null,
    };
  }

  private async releases(ids: (number | null)[]): Promise<Map<number, FeedbackReleaseDto>> {
    const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
    if (wanted.length === 0) {
      return new Map();
    }
    const projects = await this.prisma.project.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true, publishedName: true },
    });
    return new Map(
      projects.map((project) => [project.id, { id: project.id, name: hubName(project) }]),
    );
  }

  /** One bucket per period of the grain from `from` through `to`, empty ones included. */
  private series(
    rows: { score: number; createdAt: Date }[],
    from: string,
    to: string,
    grain: AnalyticsGrain,
  ): RatingSummaryDto['series'] {
    const buckets = new Map<string, number[]>();
    let period = periodOf(grain, from);
    while (period.start <= to) {
      buckets.set(period.start, []);
      period = periodOf(grain, period.end);
    }
    for (const row of rows) {
      const start = periodOf(grain, row.createdAt.toISOString().slice(0, 10)).start;
      buckets.get(start)?.push(row.score);
    }
    return [...buckets].map(([start, scores]) => ({ start, ...averageOf(scores) }));
  }
}
