import { ConflictException, HttpStatus } from "@nestjs/common";
import { ViolationCode, ViolationDto } from "./violation";

/**
 * A conflict in the envelope the validation pipe produces, so a client reads both rejections
 * through one branch.
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
