import { PasswordStrengthConstraint } from "./password-strength";

describe("PasswordStrengthConstraint", () => {
  const constraint = new PasswordStrengthConstraint();

  it.each([
    [ "letters alone", "aaaaaaaa", false ],
    [ "digits alone", "12345678", false ],
    [ "symbols alone", "!!!!!!!!", false ],
    [ "letters and digits", "aaaaaaa1", true ],
    [ "letters and symbols", "aaaaaaa!", true ],
    [ "a passphrase, whose spaces are symbols", "correct horse", true ],
    [ "an alphabet that is not Latin, with a digit", "パスワード1", true ],
    [ "letters that are not ASCII, alone", "éèêë", false ],
    [ "a number", 12345678, false ],
    [ "nothing", undefined, false ]
  ])("%s: %s", (_case, value, expected) => {
    expect(constraint.validate(value)).toBe(expected);
  });
});
