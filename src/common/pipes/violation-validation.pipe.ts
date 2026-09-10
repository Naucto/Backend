import { BadRequestException, HttpStatus, ValidationError, ValidationPipe } from "@nestjs/common";
import { collectViolations } from "@common/validation/violation";

/**
 * The stock validation pipe, plus a machine-readable account of what was rejected.
 *
 * `message` is taken from the base class's own flattener rather than rebuilt: it is the wording
 * every existing client already displays, and paraphrasing it here would quietly reword every
 * endpoint in the API at once.
 *
 * `createExceptionFactory` is called from the base constructor, so this override runs before any
 * field of this class exists -- it must read none of them.
 */
export class ViolationValidationPipe extends ValidationPipe {
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
