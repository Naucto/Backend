import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { collectViolations } from '../common/validation/violation';
import { CreateUserDto } from '../routes/user/dto/create-user.dto';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordCharacterClass } from './password-policy';

/**
 * Every password here is built from what the endpoint returns, so a validator holding a number of
 * its own fails these.
 */
describe('the published password policy is the enforced one', () => {
  const policy = new AuthController({} as AuthService).getPasswordPolicy();

  const SAMPLES: Record<PasswordCharacterClass, string> = {
    [PasswordCharacterClass.LETTERS]: 'abcdefghijklmnop',
    [PasswordCharacterClass.DIGITS]: '0123456789012345',
    [PasswordCharacterClass.SYMBOLS]: '!@#$%^&*()-_=+[]',
  };

  /** A password of `length` drawing on the first `classes` of the published character classes. */
  const build = (length: number, classes: number): string => {
    const share = Math.ceil(length / classes);
    const drawn = policy.characterClasses
      .slice(0, classes)
      .map((characterClass) => SAMPLES[characterClass].slice(0, share))
      .join('');

    return drawn.slice(0, length);
  };

  const passwordCodesOf = (password: string): string[] =>
    collectViolations(
      validateSync(
        plainToInstance(CreateUserDto, {
          email: 'user@example.com',
          username: 'someone',
          password,
        }),
      ),
    )
      .filter((violation) => violation.field === 'password')
      .map((violation) => violation.code);

  it('offers enough character classes to satisfy its own requirement', () => {
    expect(policy.characterClasses.length).toBeGreaterThanOrEqual(policy.minCharacterClasses);
  });

  it('accepts a password built to the published rule', () => {
    expect(passwordCodesOf(build(policy.minLength, policy.minCharacterClasses))).toEqual([]);
  });

  it('rejects one character short of the published minimum, and says so', () => {
    expect(passwordCodesOf(build(policy.minLength - 1, policy.minCharacterClasses))).toEqual([
      'PASSWORD_TOO_SHORT',
    ]);
  });

  it('rejects one class short of the published variety, and says so', () => {
    expect(passwordCodesOf(build(policy.minLength, policy.minCharacterClasses - 1))).toEqual([
      'PASSWORD_TOO_WEAK',
    ]);
  });

  it('hands out a fresh array, so a caller cannot edit the rule this process enforces', () => {
    const controller = new AuthController({} as AuthService);

    expect(controller.getPasswordPolicy().characterClasses).not.toBe(
      controller.getPasswordPolicy().characterClasses,
    );
  });
});
