import { Injectable } from '@nestjs/common';
import { CollectionVisibility, ModerationTargetType } from '@prisma/client';

import { currentSuspension } from '../../auth/access/suspension';
import { PrismaService } from '../../prisma/prisma.service';
import { ITEM_ORDER } from '../collections/collections.service';
import { hubName } from '../project/hub-fields';
import { TargetState, TargetVisibility } from './dto/case.dto';
import { TargetContentDto } from './dto/moderation-action.dto';
import { ACCOUNT_REF_SELECT, AccountRefRow } from './moderation-mappers';

/** What a flag or a case is about, as moderation looks at it now. */
export interface TargetView {
  type: ModerationTargetType;
  id: string;
  state: TargetState;
  /** The account itself, or the account the content belongs to. */
  owner: AccountRefRow | null;
  content: TargetContentDto | null;
  /** The game itself, or the game the target sits on. Null for a target tied to no single game. */
  project: { id: string; name: string; reachable: boolean } | null;
  /** Who its owner lets read it. Null for a target whose owner has no such choice. */
  visibility: TargetVisibility | null;
  /** The games it lists, in its order. Empty for a target that lists none. */
  games: { id: string; name: string }[];
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

  view(type: ModerationTargetType, id: string): Promise<TargetView> {
    switch (type) {
      case ModerationTargetType.USER:
        return this.account(id);
      case ModerationTargetType.PROJECT:
        return this.game(id);
      case ModerationTargetType.COMMENT:
        return this.comment(id);
      case ModerationTargetType.COLLECTION:
        return this.collection(id);
    }
  }

  private gone(type: ModerationTargetType, id: string): TargetView {
    return {
      type,
      id,
      state: 'GONE',
      owner: null,
      content: null,
      project: null,
      visibility: null,
      games: [],
    };
  }

  private async account(id: string): Promise<TargetView> {
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
      visibility: null,
      games: [],
    };
  }

  private async game(id: string): Promise<TargetView> {
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
      visibility: null,
      games: [],
    };
  }

  private async comment(id: string): Promise<TargetView> {
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
      visibility: null,
      games: [],
    };
  }

  /** A private collection exists for its owner alone, as a game nobody released does. */
  private async collection(id: string): Promise<TargetView> {
    const collection = await this.prisma.collection.findUnique({
      where: { id },
      select: {
        title: true,
        description: true,
        visibility: true,
        hiddenAt: true,
        owner: { select: ACCOUNT_REF_SELECT },
        items: {
          select: { project: { select: { id: true, name: true, publishedName: true } } },
          orderBy: ITEM_ORDER,
        },
      },
    });
    if (!collection) {
      return this.gone(ModerationTargetType.COLLECTION, id);
    }
    return {
      type: ModerationTargetType.COLLECTION,
      id,
      state: collection.hiddenAt
        ? 'HIDDEN'
        : collection.visibility === CollectionVisibility.PRIVATE
          ? 'UNPUBLISHED'
          : 'VISIBLE',
      owner: collection.owner,
      content: { title: collection.title, body: collection.description },
      project: null,
      visibility: collection.visibility,
      games: collection.items.map(({ project }) => ({ id: project.id, name: hubName(project) })),
    };
  }
}
