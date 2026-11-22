import { Prisma } from '@prisma/client';

import { parseRole, readsAddresses } from '../../auth/access/roles';
import { siteUrls } from '../../common/site-urls';
import {
  ModerationAccountRefDto,
  ModerationActionDto,
  TargetContentDto,
} from './dto/moderation-action.dto';
import { StaffActor } from './staff-actor';

const LABEL_MAX_LENGTH = 80;

export const ACCOUNT_REF_SELECT = {
  id: true,
  username: true,
  nickname: true,
  role: true,
  email: true,
  deletedAt: true,
} as const;

export type AccountRefRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_REF_SELECT }>;

export const ACTION_INCLUDE = {
  actor: { select: ACCOUNT_REF_SELECT },
  subject: { select: ACCOUNT_REF_SELECT },
} satisfies Prisma.ModerationActionInclude;

export type ActionRow = Prisma.ModerationActionGetPayload<{ include: typeof ACTION_INCLUDE }>;

export function toAccountRef(row: AccountRefRow, staff: StaffActor): ModerationAccountRefDto {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    role: parseRole(row.role),
    deleted,
    profileUrl: deleted ? null : siteUrls.profile(row.username),
    email: readsAddresses(staff.role) ? row.email : null,
  };
}

/** A stored snapshot read back. Anything that is not one reads as no snapshot. */
export function contentOf(value: Prisma.JsonValue | null): TargetContentDto | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const text = (field: Prisma.JsonValue | undefined): string | null =>
    typeof field === 'string' ? field : null;
  return { title: text(value['title']), body: text(value['body']) };
}

/** What to call a target in a list: its title, or the start of its text. */
export function labelOf(content: TargetContentDto | null): string | null {
  const label = content?.title ?? content?.body ?? null;
  if (label === null || label.length <= LABEL_MAX_LENGTH) {
    return label;
  }
  return `${label.slice(0, LABEL_MAX_LENGTH)}…`;
}

export function toActionDto(row: ActionRow, staff: StaffActor): ModerationActionDto {
  const snapshot = contentOf(row.snapshot);
  return {
    id: row.id,
    action: row.action,
    actor: toAccountRef(row.actor, staff),
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: labelOf(snapshot),
    subject: row.subject ? toAccountRef(row.subject, staff) : null,
    reason: row.reason,
    publicMessage: row.publicMessage,
    internalNote: row.internalNote,
    snapshot,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}
