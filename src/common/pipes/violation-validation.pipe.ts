import { BadRequestException, HttpStatus, ValidationError, ValidationPipe } from "@nestjs/common";
import { collectViolations } from "@common/validation/violation";

/**
 * The stock validation pipe, plus `violations`, a machine-readable account of what was rejected;
 * `message` keeps the base class's wording.
 */
export class ViolationValidationPipe extends ValidationPipe {
  // Called from the base constructor, before any field of this class exists: read none of them.
  override createExceptionFactory(): (errors?: ValidationError[]) => unknown {
    return (errors: ValidationError[] = []): unknown =>
      new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: "Bad Request",
        message: this.flattenValidationErrors(errors),
        violations: collectViolations(errors)
      });
  }
}
