import { ConflictException, HttpStatus } from "@nestjs/common";
import { ViolationCode, ViolationDto } from "./violation";

/**
 * A conflict in the same envelope the validation pipe produces.
 *
 * A duplicate email and a password too short are the same thing to a form -- one field, one rule it
 * broke -- and differ only in which layer noticed. Sharing the shape is what lets a client read
 * them through one branch instead of two.
 */
export function conflictViolation(
  message: string,
  field: string,
  code: ViolationCode
): ConflictException {
  const violations: ViolationDto[] = [ { field, code } ];

  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: "Conflict",
    message,
    violations
  });
}
