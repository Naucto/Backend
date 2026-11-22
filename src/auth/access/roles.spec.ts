import {
  ADMIN,
  holdsRole,
  MODERATOR,
  outranks,
  parseRole,
  readsAddresses,
  RoleName,
  USER,
  VIEWER,
} from './roles';

describe('holdsRole', () => {
  it.each<[RoleName, RoleName, boolean]>([
    [USER, USER, true],
    [USER, MODERATOR, false],
    [USER, ADMIN, false],
    [MODERATOR, USER, true],
    [MODERATOR, MODERATOR, true],
    [MODERATOR, ADMIN, false],
    [ADMIN, USER, true],
    [ADMIN, MODERATOR, true],
    [ADMIN, ADMIN, true],
    [VIEWER, VIEWER, true],
    [VIEWER, MODERATOR, false],
    [USER, VIEWER, false],
    [MODERATOR, VIEWER, true],
  ])('%s holds %s: %s', (userRole, required, expected) => {
    expect(holdsRole(userRole, required)).toBe(expected);
  });
});

describe('readsAddresses', () => {
  it.each<[RoleName, boolean]>([
    [USER, false],
    [VIEWER, false],
    [MODERATOR, false],
    [ADMIN, true],
  ])('%s reads email addresses: %s', (role, expected) => {
    expect(readsAddresses(role)).toBe(expected);
  });
});

describe('outranks', () => {
  it.each<[RoleName, RoleName, boolean]>([
    [MODERATOR, USER, true],
    [MODERATOR, VIEWER, true],
    [VIEWER, USER, true],
    [VIEWER, MODERATOR, false],
    [ADMIN, MODERATOR, true],
    [MODERATOR, MODERATOR, false],
    [ADMIN, ADMIN, false],
    [MODERATOR, ADMIN, false],
    [USER, USER, false],
  ])('%s outranks %s: %s', (actor, target, expected) => {
    expect(outranks(actor, target)).toBe(expected);
  });
});

describe('parseRole', () => {
  it.each<RoleName>([USER, VIEWER, MODERATOR, ADMIN])('reads %s as itself', (role) => {
    expect(parseRole(role)).toBe(role);
  });

  // Role values come from a free-text column, so they are checked rather than trusted.
  it('reads a value the hierarchy does not know as the least privilege', () => {
    expect(parseRole('NotARole')).toBe(USER);
  });

  it('matches values exactly, case included', () => {
    expect(parseRole(ADMIN.toLowerCase())).toBe(USER);
  });
});
