import { ModerationTargetType } from '@prisma/client';

import { ADMIN, holdsRole, MODERATOR, outranks, parseRole } from '../../auth/access/roles';
import { ModerationOperation, TargetState } from './dto/case.dto';
import { StaffActor } from './staff-actor';

export interface OperationContext {
  type: ModerationTargetType;
  state: TargetState;
  /** The account itself, or who owns the content. Null when nobody is left to act on. */
  owner: { id: string; role: string; deleted: boolean; suspended: boolean } | null;
  openFlags: number;
}

/**
 * What a staff member may do about a target, as the routes themselves would decide. The admin
 * console draws its buttons from this, so a rule lives here once and never in a screen.
 */
export function allowedOperations(
  staff: StaffActor,
  context: OperationContext,
): ModerationOperation[] {
  // A viewer observes and decides nothing. Nobody settles a case about their own account or content.
  if (!holdsRole(staff.role, MODERATOR) || context.owner?.id === staff.id) {
    return [];
  }
  const isAdmin = holdsRole(staff.role, ADMIN);
  const operations: ModerationOperation[] = [];

  if (context.openFlags > 0) {
    operations.push('DISMISS');
  }

  if (context.type !== ModerationTargetType.USER) {
    if (context.state === 'HIDDEN') {
      operations.push('RESTORE');
    } else if (context.state === 'VISIBLE' || context.state === 'UNPUBLISHED') {
      operations.push('HIDE');
    }
    if (isAdmin && context.state !== 'GONE') {
      operations.push('DELETE');
    }
  }

  const owner = context.owner;
  if (owner && !owner.deleted && outranks(staff.role, parseRole(owner.role))) {
    operations.push('WARN', owner.suspended ? 'REINSTATE' : 'SUSPEND', 'CLEAR_PROFILE');
    if (isAdmin) {
      operations.push('DELETE_ACCOUNT');
    }
  }

  return operations;
}
