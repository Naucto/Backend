import { Injectable } from '@nestjs/common';
import { ModerationTargetType } from '@prisma/client';

import { currentSuspension } from '../../auth/access/suspension';
import { PrismaService } from '../../prisma/prisma.service';
import { hubName } from '../project/hub-fields';
import { TargetState } from './dto/case.dto';
import { TargetContentDto } from './dto/moderation-action.dto';
import { ACCOUNT_REF_SELECT, AccountRefRow } from './moderation-mappers';

/** A game, a comment or an account as moderation looks at it now. */
export interface TargetView {
  type: ModerationTargetType;
  id: number;
  state: TargetState;
  /** The account itself, the creator of the game or the author of the comment. */
  owner: AccountRefRow | null;
  content: TargetContentDto | null;
  /** The game itself, or the game a comment is on. */
  project: { id: number; name: string; reachable: boolean } | null;
}

const PROJECT_SELECT = {
  id: true,
  name: true,
  shortDesc: true,
  longDesc: true,
  publishedName: true,
  publishedShortDesc: true,
  publishedLongDesc: true,
  publishedAt: true,
  hiddenAt: true,
  creator: { select: ACCOUNT_REF_SELECT },
} as const;

/** Reads what a flag or a case is about, whatever players can see of it. */
@Injectable()
export class ModerationTargetService {
  constructor(private readonly prisma: PrismaService) {}

  view(type: ModerationTargetType, id: number): Promise<TargetView> {
    switch (type) {
      case ModerationTargetType.USER:
        return this.account(id);
      case ModerationTargetType.PROJECT:
        return this.game(id);
      case ModerationTargetType.COMMENT:
        return this.comment(id);
    }
  }

  private gone(type: ModerationTargetType, id: number): TargetView {
    return { type, id, state: 'GONE', owner: null, content: null, project: null };
  }

  private async account(id: number): Promise<TargetView> {
    const account = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...ACCOUNT_REF_SELECT,
        description: true,
        suspendedAt: true,
        suspendedUntil: true,
      },
    });
    if (!account) {
      return this.gone(ModerationTargetType.USER, id);
    }
    const { description, suspendedAt, suspendedUntil, ...owner } = account;
    return {
      type: ModerationTargetType.USER,
      id,
      state: account.deletedAt
        ? 'DELETED'
        : currentSuspension({ suspendedAt, suspendedUntil })
          ? 'SUSPENDED'
          : 'VISIBLE',
      owner,
      content: { title: account.nickname ?? account.username, body: description },
      project: null,
    };
  }

  private async game(id: number): Promise<TargetView> {
    const game = await this.prisma.project.findUnique({ where: { id }, select: PROJECT_SELECT });
    if (!game) {
      return this.gone(ModerationTargetType.PROJECT, id);
    }
    const body = [
      game.publishedShortDesc || game.shortDesc,
      game.publishedLongDesc || game.longDesc,
    ]
      .filter((part): part is string => Boolean(part))
      .join('\n\n');
    const state: TargetState = game.hiddenAt
      ? 'HIDDEN'
      : game.publishedAt
        ? 'VISIBLE'
        : 'UNPUBLISHED';
    return {
      type: ModerationTargetType.PROJECT,
      id,
      state,
      owner: game.creator,
      content: { title: hubName(game), body: body || null },
      project: { id, name: hubName(game), reachable: state === 'VISIBLE' },
    };
  }

  private async comment(id: number): Promise<TargetView> {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      select: {
        content: true,
        deleted: true,
        hiddenAt: true,
        author: { select: ACCOUNT_REF_SELECT },
        project: {
          select: { id: true, name: true, publishedName: true, publishedAt: true, hiddenAt: true },
        },
      },
    });
    if (!comment) {
      return this.gone(ModerationTargetType.COMMENT, id);
    }
    return {
      type: ModerationTargetType.COMMENT,
      id,
      state: comment.hiddenAt ? 'HIDDEN' : comment.deleted ? 'DELETED' : 'VISIBLE',
      owner: comment.author,
      content: { title: null, body: comment.content },
      project: {
        id: comment.project.id,
        name: hubName(comment.project),
        reachable: comment.project.publishedAt !== null && comment.project.hiddenAt === null,
      },
    };
  }
}
