import { Injectable } from '@nestjs/common';
import { RatingOrigin, RatingReason, ReportRole } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreatedReportDto } from './dto/created-report.dto';
import { FeedbackPromptDto, PromptAction } from './dto/prompt.dto';

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

const blankToNull = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value;

/** What signed-in players and creators send: the rating prompt's state and their ratings. */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
