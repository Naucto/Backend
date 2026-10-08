/**
 * The kinds of character a password is measured against; an enum, so the generated client exports
 * constants instead of string literals.
 */
export enum PasswordCharacterClass {
  LETTERS = 'letters',
  DIGITS = 'digits',
  SYMBOLS = 'symbols',
}

/**
 * The password rule, read by the validators and by the endpoint that publishes it, so the two
 * cannot disagree.
 */
export const PASSWORD_POLICY = {
  minLength: 8,
  minCharacterClasses: 2,
  characterClasses: [
    PasswordCharacterClass.LETTERS,
    PasswordCharacterClass.DIGITS,
    PasswordCharacterClass.SYMBOLS,
  ],
} as const;
