import { ADMIN, holdsRole, MODERATOR, parseRole, RoleName, USER } from './roles';

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
  ])('%s holds %s: %s', (userRole, required, expected) => {
    expect(holdsRole(userRole, required)).toBe(expected);
  });
});

describe('parseRole', () => {
  it.each<RoleName>([USER, MODERATOR, ADMIN])('reads %s as itself', (role) => {
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
