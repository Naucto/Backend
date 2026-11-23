import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { FlagStatus, ModerationTargetType } from '@prisma/client';

import { CodedException } from '../../common/coded.exception';
import { isUniqueViolation, PrismaService } from '../../prisma/prisma.service';
import { TargetState } from './dto/case.dto';
import { CreatedFlagDto, CreateFlagDto } from './dto/flag.dto';
import { FlagNotifier } from './flag-notifier';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationTargetService, TargetView } from './moderation-target.service';

/**
 * The states in which a target can be flagged: what the reporter can see. A suspended account
 * still shows its profile, so it can still be reported.
 */
const FLAGGABLE: Record<ModerationTargetType, readonly TargetState[]> = {
  USER: ['VISIBLE', 'SUSPENDED'],
  PROJECT: ['VISIBLE'],
  COMMENT: ['VISIBLE'],
};

/** What people report to staff. */
@Injectable()
export class FlagsService {
  private readonly logger = new Logger(FlagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly targets: ModerationTargetService,
    private readonly notifier: FlagNotifier,
  ) {}

  async create(reporterId: string, input: CreateFlagDto): Promise<CreatedFlagDto> {
    const target = await this.flaggable(input.targetType, input.targetId);
    if (target.owner?.id === reporterId) {
      throw new CodedException(
        HttpStatus.BAD_REQUEST,
        MODERATION_ERROR.CANNOT_FLAG_OWN_CONTENT,
        'You cannot report your own content',
      );
    }

    let flag: { id: string };
    try {
      flag = await this.prisma.flag.create({
        data: {
          reporterId,
          targetType: input.targetType,
          targetId: input.targetId,
          targetOwnerId: target.owner?.id ?? null,
          reason: input.reason,
          details: input.details || null,
          snapshot: { ...target.content },
          openKey: `${reporterId}:${input.targetType}:${input.targetId}`,
        },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CodedException(
          HttpStatus.CONFLICT,
          MODERATION_ERROR.ALREADY_FLAGGED,
          'You already reported this, and staff have not settled it yet',
        );
      }
      throw error;
    }

    await this.announce(input);
    return flag;
  }

  /**
   * The target as the reporter sees it, or the same 404 for one that is gone as for one that is
   * hidden from them: a report must not tell a draft or a removed comment from nothing at all.
   */
  private async flaggable(type: ModerationTargetType, id: string): Promise<TargetView> {
    const target = await this.targets.view(type, id);
    const reachable = FLAGGABLE[type].includes(target.state) && (target.project?.reachable ?? true);
    if (!reachable) {
      throw new CodedException(
        HttpStatus.NOT_FOUND,
        MODERATION_ERROR.FLAG_TARGET_NOT_FOUND,
        'Nothing to report there',
      );
    }
    return target;
  }

  /** Staff hear about a case once, when it opens, not once per report on it. */
  private async announce(input: CreateFlagDto): Promise<void> {
    try {
      const open = await this.prisma.flag.count({
        where: { targetType: input.targetType, targetId: input.targetId, status: FlagStatus.OPEN },
      });
      if (open === 1) {
        await this.notifier.caseOpened(input);
      }
    } catch (error) {
      this.logger.warn(
        `Could not announce a report: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
