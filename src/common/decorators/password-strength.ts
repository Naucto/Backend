import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { PASSWORD_POLICY, PasswordCharacterClass } from '../../auth/password-policy';

/**
 * Unicode letters, Unicode numbers, and everything else: whitespace counts as a symbol, so the
 * spaces of a passphrase add variety.
 */
const CLASS_PATTERNS: Record<PasswordCharacterClass, RegExp> = {
  [PasswordCharacterClass.LETTERS]: /\p{L}/u,
  [PasswordCharacterClass.DIGITS]: /\p{N}/u,
  [PasswordCharacterClass.SYMBOLS]: /[^\p{L}\p{N}]/u,
};

@ValidatorConstraint({ name: 'passwordStrength', async: false })
export class PasswordStrengthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }

    const used = PASSWORD_POLICY.characterClasses.filter((characterClass) =>
      CLASS_PATTERNS[characterClass].test(value),
    ).length;

    return used >= PASSWORD_POLICY.minCharacterClasses;
  }

  defaultMessage(): string {
    return (
      'Password must mix at least ' +
      `${String(PASSWORD_POLICY.minCharacterClasses)} of: ${PASSWORD_POLICY.characterClasses.join(', ')}`
    );
  }
}

export function PasswordStrength(
  validationOptions?: ValidationOptions,
): (object: object, propertyName: string) => void {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions ?? {},
      constraints: [],
      validator: PasswordStrengthConstraint,
    });
  };
}
