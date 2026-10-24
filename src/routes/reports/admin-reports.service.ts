import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AnalyticsGrain,
  BugCategory,
  Prisma,
  ReportKind,
  ReportRole,
  ReportStatus,
} from '@prisma/client';

import { PageRequest, toSkipTake } from '../../common/dto/pagination-query.dto';
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
  AdminReportDetailDto,
  AdminReportDto,
  AdminReportListDto,
  ReportAccountDto,
  ReportReleaseDto,
} from './dto/admin-report.dto';
import { ReportView } from './dto/admin-report-query.dto';
import { RATING_MAX } from './dto/rating.dto';
import { RatingAverageDto, RatingSummaryDto } from './dto/rating-summary.dto';

const LOW_SCORE_MAX = 4;
const LIST_PAGE_SIZE = 20;

const VIEW_STATUSES: Record<ReportView, ReportStatus[] | null> = {
  NEW: ['NEW'],
  OPEN: ['NEW', 'TRIAGED', 'IN_PROGRESS'],
  CLOSED: ['RESOLVED', 'IGNORED'],
  ALL: null,
};

export interface ReportFilter {
  kind?: ReportKind | undefined;
  view?: ReportView | undefined;
  status?: ReportStatus | undefined;
  role?: ReportRole | undefined;
  maxScore?: number | undefined;
  withComments?: boolean | undefined;
  category?: BugCategory | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface ReportUpdate {
  status?: ReportStatus | undefined;
  adminNote?: string | null | undefined;
}

const REPORT_INCLUDE = {
  user: { select: ADMIN_ACCOUNT_SELECT },
  followUps: { select: { id: true }, orderBy: { id: 'asc' } },
} as const;
type ReportRow = Prisma.ReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

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

/** What the admin console reads of reports, and the triage it writes back. */
@Injectable()
export class AdminReportsService {
  private readonly frontendUrl = getOptionalEnv('FRONTEND_URL', 'http://localhost:3001').replace(
    /\/+$/,
    '',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async list(filter: ReportFilter, page: PageRequest): Promise<AdminReportListDto> {
    const { skip, take } = toSkipTake(page, LIST_PAGE_SIZE);
    const where = this.where(filter);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        include: REPORT_INCLUDE,
      }),
    ]);
    const releases = await this.releases(rows.map((row) => row.releaseId));
    return {
      items: rows.map((row) => this.summary(row, releases)),
      total,
      page: page.page ?? 1,
      limit: take,
    };
  }

  async count(kind: ReportKind, status: ReportStatus | undefined): Promise<number> {
    return this.prisma.report.count({ where: { kind, ...(status ? { status } : {}) } });
  }

  async detail(id: number): Promise<AdminReportDetailDto> {
    const row = await this.prisma.report.findUnique({
      where: { id },
      include: {
        ...REPORT_INCLUDE,
        rating: { select: { id: true, score: true, liked: true, improve: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Report not found');
    }
    const releases = await this.releases([row.releaseId]);
    return {
      ...this.summary(row, releases),
      adminNote: row.adminNote,
      projectId: row.projectId,
      context:
        typeof row.context === 'object' && row.context !== null && !Array.isArray(row.context)
          ? (row.context as Record<string, unknown>)
          : null,
      rating:
        row.rating && row.rating.score !== null ? { ...row.rating, score: row.rating.score } : null,
      screenshot:
        row.screenshotKey && row.screenshotMime
          ? { mime: row.screenshotMime, bytes: row.screenshotBytes ?? 0 }
          : null,
    };
  }

  async screenshot(id: number): Promise<DownloadedFile> {
    const row = await this.prisma.report.findUnique({
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

  async update(id: number, update: ReportUpdate): Promise<AdminReportDetailDto> {
    const updated = await this.prisma.report.updateMany({
      where: { id },
      data: {
        ...(update.status ? { status: update.status } : {}),
        ...(update.adminNote !== undefined ? { adminNote: update.adminNote?.trim() || null } : {}),
      },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Report not found');
    }
    return this.detail(id);
  }

  async ratingSummary(from: string, to: string, grain: AnalyticsGrain): Promise<RatingSummaryDto> {
    const rows = await this.prisma.report.findMany({
      where: { kind: 'RATING', createdAt: dayRange(from, to) ?? {} },
      select: { score: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const rated = rows.flatMap((row) => (row.score === null ? [] : [{ ...row, score: row.score }]));
    const scores = rated.map((row) => row.score);
    const low = scores.filter((score) => score <= LOW_SCORE_MAX).length;

    return {
      ...averageOf(scores),
      lowShare: scores.length === 0 ? null : Math.round((low / scores.length) * 1000) / 1000,
      distribution: Array.from(
        { length: RATING_MAX },
        (_, index) => scores.filter((score) => score === index + 1).length,
      ),
      player: averageOf(rated.filter((row) => row.role === 'PLAYER').map((row) => row.score)),
      creator: averageOf(rated.filter((row) => row.role === 'CREATOR').map((row) => row.score)),
      series: this.series(rated, from, to, grain),
    };
  }

  private where(filter: ReportFilter): Prisma.ReportWhereInput {
    const statuses = filter.status ? [filter.status] : VIEW_STATUSES[filter.view ?? 'ALL'];
    const createdAt = dayRange(filter.from, filter.to);
    return {
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(statuses ? { status: { in: statuses } } : {}),
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.maxScore ? { score: { lte: filter.maxScore } } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(filter.withComments
        ? { OR: [{ liked: { not: null } }, { improve: { not: null } }] }
        : {}),
    };
  }

  private summary(row: ReportRow, releases: Map<number, ReportReleaseDto>): AdminReportDto {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      account: row.user ? this.account(row.user) : null,
      role: row.role,
      route: row.route,
      release: row.releaseId ? (releases.get(row.releaseId) ?? null) : null,
      appRelease: row.appRelease,
      title: row.title,
      message: row.message,
      score: row.score,
      reasons: row.reasons,
      liked: row.liked,
      improve: row.improve,
      origin: row.origin,
      followUpIds: row.followUps.map((report) => report.id),
      category: row.category,
      ratingId: row.ratingId,
      hasScreenshot: row.screenshotKey !== null,
    };
  }

  private account(row: AdminAccountRow): ReportAccountDto {
    const deleted = row.deletedAt !== null;
    return {
      ...toAccountSummary(row),
      deleted,
      profileUrl: deleted ? null : `${this.frontendUrl}/u/${encodeURIComponent(row.username)}`,
    };
  }

  private async releases(ids: (number | null)[]): Promise<Map<number, ReportReleaseDto>> {
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
