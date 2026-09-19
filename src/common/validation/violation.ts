import { ValidationError } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";

/**
 * The rules a client is allowed to recognise by name.
 *
 * A code outlives the validator that raises it: swapping @MinLength for @Length must not rename
 * one, which is why they are chosen here rather than read off the constraint. Anything absent from
 * this union still reaches the client, derived from the constraint, but only as a hint -- a client
 * that cannot place a code falls back to the message.
 */
export const VIOLATION_CODES = [
  "EMAIL_INVALID",
  "EMAIL_REQUIRED",
  "EMAIL_TAKEN",
  "USERNAME_LENGTH",
  "USERNAME_TAKEN",
  "NICKNAME_LENGTH",
  "PASSWORD_REQUIRED",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_WEAK"
] as const;

export type ViolationCode = (typeof VIOLATION_CODES)[number];

/**
 * `context: violation("PASSWORD_TOO_SHORT")` on a validator.
 *
 * class-validator types `context` as `any`, so this call is the only place a misspelt code is
 * caught at all.
 */
export function violation(code: ViolationCode): { code: ViolationCode } {
  return { code };
}

export class ViolationDto {
  @ApiProperty({
    description: "Dotted path of the rejected field, array indices included",
    example: "password"
  })
    field!: string;

  @ApiProperty({
    description: "Stable identifier for the rule it broke",
    example: "PASSWORD_TOO_SHORT"
  })
    code!: string;
}

const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g;
/** What class-validator calls the rejection of a field no DTO declares. */
const WHITELIST_CONSTRAINT = "whitelistValidation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function codeOf(error: ValidationError, constraint: string): string {
  const context: unknown = error.contexts?.[constraint];

  if (isRecord(context) && typeof context["code"] === "string") {
    return context["code"];
  }

  if (constraint === WHITELIST_CONSTRAINT) {
    return "UNKNOWN_FIELD";
  }

  // The constraint alone, never the property: the property is already in `field`, and folding it in
  // would make a renamed field silently rename the code too.
  return constraint.replace(CAMEL_BOUNDARY, "$1_$2").toUpperCase();
}

/**
 * One entry per broken rule.
 *
 * The order within a field is class-validator's own and is not the order the decorators are
 * written in, so a client picking one violation to show should pick a code it recognises rather
 * than the first it is handed.
 *
 * Nested errors carry the path they were found at, so a form can mark the row of an array as
 * readily as a field -- a parent node holds children and no constraints of its own, and
 * contributes nothing itself.
 */
export function collectViolations(
  errors: readonly ValidationError[],
  parentPath = ""
): ViolationDto[] {
  const violations: ViolationDto[] = [];

  for (const error of errors) {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;

    for (const constraint of Object.keys(error.constraints ?? {})) {
      violations.push({ field, code: codeOf(error, constraint) });
    }

    if (error.children && error.children.length > 0) {
      violations.push(...collectViolations(error.children, field));
    }
  }

  return violations;
}
