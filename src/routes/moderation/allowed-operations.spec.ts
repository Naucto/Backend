import { ModerationTargetType } from '@prisma/client';

import { uuidOf } from '../../../test/uuid';
import { ADMIN, MODERATOR, USER, VIEWER } from '../../auth/access/roles';
import { allowedOperations, OperationContext } from './allowed-operations';

const MOD = { id: uuidOf(1), role: MODERATOR } as const;
const BOSS = { id: uuidOf(2), role: ADMIN } as const;

type Owner = NonNullable<OperationContext['owner']>;

const owner = (overrides: Partial<Owner> = {}): Owner => ({
  id: uuidOf(7),
  role: USER as string,
  deleted: false,
  suspended: false,
  ...overrides,
});

const comment = (overrides: Partial<OperationContext> = {}): OperationContext => ({
  type: ModerationTargetType.COMMENT,
  state: 'VISIBLE',
  owner: owner(),
  openFlags: 1,
  ...overrides,
});

describe('allowedOperations', () => {
  it('gives a moderator the reversible work, on the content and on its author', () => {
    expect(allowedOperations(MOD, comment())).toEqual([
      'DISMISS',
      'HIDE',
      'WARN',
      'SUSPEND',
      'CLEAR_PROFILE',
    ]);
  });

  it('offers a viewer nothing, on any target in any state', () => {
    const viewer = { id: uuidOf(3), role: VIEWER } as const;

    expect(allowedOperations(viewer, comment())).toEqual([]);
    expect(allowedOperations(viewer, comment({ state: 'HIDDEN' }))).toEqual([]);
  });

  it('adds the permanent deletions for an admin', () => {
    expect(allowedOperations(BOSS, comment())).toEqual([
      'DISMISS',
      'HIDE',
      'DELETE',
      'WARN',
      'SUSPEND',
      'CLEAR_PROFILE',
      'DELETE_ACCOUNT',
    ]);
  });

  it('offers nothing on a case about the staff member themselves', () => {
    expect(allowedOperations(MOD, comment({ owner: owner({ id: MOD.id }) }))).toEqual([]);
  });

  it('offers to restore what is hidden, not to hide it again', () => {
    const operations = allowedOperations(MOD, comment({ state: 'HIDDEN' }));

    expect(operations).toContain('RESTORE');
    expect(operations).not.toContain('HIDE');
  });

  it('offers to reinstate a suspended owner, not to suspend them again', () => {
    const operations = allowedOperations(MOD, comment({ owner: owner({ suspended: true }) }));

    expect(operations).toContain('REINSTATE');
    expect(operations).not.toContain('SUSPEND');
  });

  it('has nothing to dismiss once no flag is open', () => {
    expect(allowedOperations(MOD, comment({ openFlags: 0 }))).not.toContain('DISMISS');
  });

  it('acts on the content of staff of equal rank, but never on their account', () => {
    expect(allowedOperations(MOD, comment({ owner: owner({ role: MODERATOR }) }))).toEqual([
      'DISMISS',
      'HIDE',
    ]);
  });

  it('leaves a target that is gone with its flags to dismiss and its owner to act on', () => {
    expect(allowedOperations(BOSS, comment({ state: 'GONE' }))).toEqual([
      'DISMISS',
      'WARN',
      'SUSPEND',
      'CLEAR_PROFILE',
      'DELETE_ACCOUNT',
    ]);
  });

  it.each([ModerationTargetType.PROJECT, ModerationTargetType.COLLECTION])(
    'treats a %s as it treats any content, kept to its owner or not',
    (type) => {
      for (const state of ['VISIBLE', 'UNPUBLISHED'] as const) {
        expect(allowedOperations(BOSS, comment({ type, state }))).toEqual(
          allowedOperations(BOSS, comment()),
        );
      }
      expect(allowedOperations(MOD, comment({ type, state: 'HIDDEN' }))).toEqual(
        allowedOperations(MOD, comment({ state: 'HIDDEN' })),
      );
    },
  );

  it('has no content to hide when the target is an account', () => {
    const operations = allowedOperations(
      BOSS,
      comment({ type: ModerationTargetType.USER, state: 'VISIBLE' }),
    );

    expect(operations).toEqual(['DISMISS', 'WARN', 'SUSPEND', 'CLEAR_PROFILE', 'DELETE_ACCOUNT']);
  });

  it('acts on nobody once the owner is erased', () => {
    expect(allowedOperations(BOSS, comment({ owner: owner({ deleted: true }) }))).toEqual([
      'DISMISS',
      'HIDE',
      'DELETE',
    ]);
  });
});
