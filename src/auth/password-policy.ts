/**
 * The kinds of character a password is measured against.
 *
 * An enum rather than a string union so the generated client hands the frontend constants to
 * compare against, instead of literals it would have to spell correctly.
 */
export enum PasswordCharacterClass {
  LETTERS = "letters",
  DIGITS = "digits",
  SYMBOLS = "symbols"
}

/**
 * The rule the API enforces, and the rule it publishes.
 *
 * They are the same object on purpose. A policy endpoint that repeats a number the validator also
 * holds has solved nothing: the two would drift the first time one of them was edited alone, and
 * the API would then advertise a rule it does not apply. Nothing below this line may write a
 * length or a count of its own.
 */
export const PASSWORD_POLICY = {
  minLength: 8,
  minCharacterClasses: 2,
  characterClasses: [
    PasswordCharacterClass.LETTERS,
    PasswordCharacterClass.DIGITS,
    PasswordCharacterClass.SYMBOLS
  ]
} as const;
