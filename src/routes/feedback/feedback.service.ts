import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FeedbackContext, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { summarizeUserAgent } from '../analytics/request-context';
import { FeaturesService } from '../features/features.service';
import { S3Service } from '../s3/s3.service';
import {
  CreateBugReportDto,
  CreatedFeedbackDto,
  CreateRatingDto,
  FeedbackPromptsDto,
  FeedbackPromptStateDto,
  PromptAction,
} from './dto/feedback.dto';

const FEEDBACK_CONTEXTS = Object.values(FeedbackContext);

export const PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

const SCREENSHOT_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export const screenshotKey = (reportId: number, mime: string): string =>
  `feedback/bugs/${reportId}/screenshot.${SCREENSHOT_EXTENSIONS[mime] ?? 'bin'}`;

const blankToNull = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

/** What signed-in players and creators send: the rating prompt's state, ratings and bug reports. */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
    private readonly s3Service: S3Service,
  ) {}

  /** Every feedback route answers 404 while the flag is off, as if it did not exist. */
  assertEnabled(): void {
    if (!this.features.features.feedback) {
      throw new NotFoundException();
    }
  }

  async promptState(userId: number, now: Date = new Date()): Promise<FeedbackPromptsDto> {
    const prompts = await this.prisma.feedbackPrompt.findMany({
      where: { userId },
      select: { context: true, status: true, snoozedUntil: true },
    });
    const stateOf = (context: FeedbackContext): FeedbackPromptStateDto => {
      const prompt = prompts.find((row) => row.context === context);
      if (!prompt) {
        return { eligible: true, declined: false };
      }
      const snoozeOver =
        prompt.status === 'SNOOZED' && (!prompt.snoozedUntil || prompt.snoozedUntil <= now);
      return { eligible: snoozeOver, declined: prompt.status === 'DECLINED' };
    };
    return { player: stateOf('PLAYER'), creator: stateOf('CREATOR') };
  }

  async updatePrompt(
    userId: number,
    action: PromptAction,
    context: FeedbackContext | undefined,
    now: Date = new Date(),
  ): Promise<FeedbackPromptsDto> {
    const contexts = context ? [context] : FEEDBACK_CONTEXTS;
    if (action === 'reset') {
      await this.prisma.feedbackPrompt.deleteMany({
        where: { userId, context: { in: contexts } },
      });
    } else if (action === 'decline') {
      await this.prisma.$transaction(
        contexts.map((each) =>
          this.prisma.feedbackPrompt.upsert({
            where: { userId_context: { userId, context: each } },
            create: { userId, context: each, status: 'DECLINED' },
            update: { status: 'DECLINED', snoozedUntil: null },
          }),
        ),
      );
    } else {
      const snoozedUntil = new Date(now.getTime() + PROMPT_SNOOZE_MS);
      // Closing the prompt never undoes an answer or a refusal given before.
      await this.prisma.$transaction(async (tx) => {
        for (const each of contexts) {
          const current = await tx.feedbackPrompt.findUnique({
            where: { userId_context: { userId, context: each } },
            select: { status: true },
          });
          if (current && current.status !== 'SNOOZED') {
            continue;
          }
          await tx.feedbackPrompt.upsert({
            where: { userId_context: { userId, context: each } },
            create: { userId, context: each, status: 'SNOOZED', snoozedUntil },
            update: { status: 'SNOOZED', snoozedUntil },
          });
        }
      });
    }
    return this.promptState(userId, now);
  }

  async createRating(userId: number, dto: CreateRatingDto): Promise<CreatedFeedbackDto> {
    const rating = await this.prisma.$transaction(async (tx) => {
      const created = await tx.platformRating.create({
        data: {
          userId,
          score: dto.score,
          reasons: [...new Set(dto.reasons ?? [])],
          liked: blankToNull(dto.liked),
          improve: blankToNull(dto.improve),
          context: dto.context,
          source: dto.source,
          releaseId: dto.releaseId ?? null,
          appRelease: dto.appRelease ?? null,
        },
        select: { id: true },
      });
      // An answer ends the prompt of its context for good. A declined one stays declined.
      await tx.feedbackPrompt.upsert({
        where: { userId_context: { userId, context: dto.context } },
        create: { userId, context: dto.context, status: 'ANSWERED' },
        update: {},
      });
      await tx.feedbackPrompt.updateMany({
        where: { userId, context: dto.context, status: 'SNOOZED' },
        data: { status: 'ANSWERED', snoozedUntil: null },
      });
      return created;
    });
    return { id: rating.id };
  }

  async createBugReport(
    userId: number,
    dto: CreateBugReportDto,
    userAgent: string | undefined,
    screenshot: Express.Multer.File | undefined,
  ): Promise<CreatedFeedbackDto> {
    const ratingId =
      dto.ratingId === undefined
        ? null
        : ((
            await this.prisma.platformRating.findFirst({
              where: { id: dto.ratingId, userId },
              select: { id: true },
            })
          )?.id ?? null);

    const { device, browser, os } = summarizeUserAgent(userAgent);
    const context: Prisma.InputJsonObject = {
      ...(dto.context ? { ...dto.context } : {}),
      device,
      browser,
      os,
    };

    const report = await this.prisma.bugReport.create({
      data: {
        userId,
        category: dto.category,
        title: dto.title,
        description: dto.description,
        route: dto.route,
        releaseId: dto.releaseId ?? null,
        projectId: dto.projectId ?? null,
        ratingId,
        context,
      },
      select: { id: true },
    });

    if (screenshot) {
      await this.storeScreenshot(report.id, screenshot);
    }
    return { id: report.id };
  }

  /** A report whose screenshot cannot be stored is still a report: it is kept without it. */
  private async storeScreenshot(reportId: number, file: Express.Multer.File): Promise<void> {
    const keyName = screenshotKey(reportId, file.mimetype);
    try {
      await this.s3Service.uploadFile({ file, keyName, cacheControl: 'private, no-store' });
      await this.prisma.bugReport.update({
        where: { id: reportId },
        data: { screenshotKey: keyName, screenshotMime: file.mimetype, screenshotBytes: file.size },
      });
    } catch (error) {
      this.logger.warn(
        `Could not store the screenshot of bug report ${reportId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
