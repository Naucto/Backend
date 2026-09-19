import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
  ValidationOptions
} from "class-validator";
import { PASSWORD_POLICY } from "@auth/password-policy";

/**
 * Length admits "aaaaaaaa" and variety alone admits "aA1!"; the policy is the pair, and this half
 * answers only for the variety.
 *
 * Unicode-aware, which is the point of the property escapes: an alphabet that is not Latin is still
 * letters, and anything that is neither letter nor number counts as a symbol -- whitespace
 * included, because the spaces in a passphrase are not what makes it weak.
 */
const CHARACTER_CLASSES: readonly RegExp[] = [ /\p{L}/u, /\p{N}/u, /[^\p{L}\p{N}]/u ];

@ValidatorConstraint({ name: "passwordStrength", async: false })
export class PasswordStrengthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string") {
      return false;
    }

    const used = CHARACTER_CLASSES.filter(characterClass => characterClass.test(value)).length;

    return used >= PASSWORD_POLICY.minCharacterClasses;
  }

  defaultMessage(): string {
    return "Password must mix at least " +
      `${String(PASSWORD_POLICY.minCharacterClasses)} of: letters, digits, symbols`;
  }
}

export function PasswordStrength(
  validationOptions?: ValidationOptions
): (object: object, propertyName: string) => void {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions ?? {},
      constraints: [],
      validator: PasswordStrengthConstraint
    });
  };
}
