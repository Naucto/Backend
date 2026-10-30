import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BugCategory, Prisma, RatingOrigin, RatingReason, ReportRole } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { summarizeUserAgent } from '../analytics/request-context';
import { S3Service } from '../s3/s3.service';
import { CreatedReportDto } from './dto/created-report.dto';
import { FeedbackPromptDto, PromptAction } from './dto/prompt.dto';
import { SCREENSHOT_WINDOW_MS, screenshotKey } from './report-screenshot';

/** How long "not now" keeps the rating prompt away. */
export const PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export interface NewRating {
  score: number;
  role: ReportRole;
  origin: RatingOrigin;
  reasons: RatingReason[];
  liked?: string | undefined;
  improve?: string | undefined;
  releaseId?: number | undefined;
}

export interface NewBugReport {
  category: BugCategory;
  title: string;
  description: string;
  route: string;
  role?: ReportRole | undefined;
  releaseId?: number | undefined;
  projectId?: number | undefined;
  ratingId?: number | undefined;
  appRelease?: string | undefined;
  context?: BugContext | undefined;
}

export interface BugContext {
  viewport?: string | undefined;
  language?: string | undefined;
  engineError?: string | undefined;
  console?: string[] | undefined;
}

const blankToNull = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

/** What signed-in players and creators send: the rating prompt's state, ratings and bug reports. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async promptState(userId: number, now: Date = new Date()): Promise<FeedbackPromptDto> {
    const prompt = await this.prisma.feedbackPrompt.findUnique({
      where: { userId },
      select: { status: true, snoozedUntil: true },
    });
    if (!prompt) {
      return { eligible: true, declined: false };
    }
    const snoozeOver =
      prompt.status === 'SNOOZED' && (!prompt.snoozedUntil || prompt.snoozedUntil <= now);
    return { eligible: snoozeOver, declined: prompt.status === 'DECLINED' };
  }

  async updatePrompt(
    userId: number,
    action: PromptAction,
    now: Date = new Date(),
  ): Promise<FeedbackPromptDto> {
    if (action === 'reset') {
      await this.prisma.feedbackPrompt.deleteMany({ where: { userId } });
    } else if (action === 'decline') {
      await this.prisma.feedbackPrompt.upsert({
        where: { userId },
        create: { userId, status: 'DECLINED' },
        update: { status: 'DECLINED', snoozedUntil: null },
      });
    } else {
      const snoozedUntil = new Date(now.getTime() + PROMPT_SNOOZE_MS);
      // Closing the prompt never undoes an answer or a refusal given before.
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.feedbackPrompt.findUnique({
          where: { userId },
          select: { status: true },
        });
        if (current && current.status !== 'SNOOZED') {
          return;
        }
        await tx.feedbackPrompt.upsert({
          where: { userId },
          create: { userId, status: 'SNOOZED', snoozedUntil },
          update: { status: 'SNOOZED', snoozedUntil },
        });
      });
    }
    return this.promptState(userId, now);
  }

  async createRating(userId: number, rating: NewRating): Promise<CreatedReportDto> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.report.create({
        data: {
          kind: 'RATING',
          userId,
          role: rating.role,
          score: rating.score,
          reasons: [...new Set(rating.reasons)],
          liked: blankToNull(rating.liked),
          improve: blankToNull(rating.improve),
          origin: rating.origin,
          releaseId: rating.releaseId ?? null,
        },
        select: { id: true },
      });
      // A rating, asked for or not, ends the prompt for good. A refusal stays a refusal.
      await tx.feedbackPrompt.upsert({
        where: { userId },
        create: { userId, status: 'ANSWERED' },
        update: {},
      });
      await tx.feedbackPrompt.updateMany({
        where: { userId, status: 'SNOOZED' },
        data: { status: 'ANSWERED', snoozedUntil: null },
      });
      return created;
    });
  }

  async createBugReport(
    userId: number,
    bug: NewBugReport,
    userAgent: string | undefined,
  ): Promise<CreatedReportDto> {
    const rating =
      bug.ratingId === undefined
        ? null
        : await this.prisma.report.findFirst({
            where: { id: bug.ratingId, userId, kind: 'RATING' },
            select: { id: true },
          });
    const { device, browser, os } = summarizeUserAgent(userAgent);
    const context: Prisma.InputJsonObject = { ...bug.context, device, browser, os };

    return this.prisma.report.create({
      data: {
        kind: 'BUG',
        userId,
        role: bug.role ?? null,
        category: bug.category,
        title: bug.title,
        message: bug.description,
        route: bug.route,
        releaseId: bug.releaseId ?? null,
        projectId: bug.projectId ?? null,
        ratingId: rating?.id ?? null,
        appRelease: bug.appRelease ?? null,
        context,
      },
      select: { id: true },
    });
  }

  /** Attaches the screenshot of a bug report its author just sent. */
  async attachScreenshot(
    userId: number,
    reportId: number,
    file: Express.Multer.File,
    now: Date = new Date(),
  ): Promise<void> {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, userId, kind: 'BUG' },
      select: { createdAt: true, screenshotKey: true },
    });
    if (!report) {
      throw new NotFoundException('Bug report not found');
    }
    if (report.screenshotKey || now.getTime() - report.createdAt.getTime() > SCREENSHOT_WINDOW_MS) {
      throw new ConflictException('This report takes no more screenshots');
    }
    const keyName = screenshotKey(reportId, file.mimetype);
    await this.s3Service.uploadFile({ file, keyName, cacheControl: 'private, no-store' });
    await this.prisma.report.update({
      where: { id: reportId },
      data: { screenshotKey: keyName, screenshotMime: file.mimetype, screenshotBytes: file.size },
    });
  }
}
