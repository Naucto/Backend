import { HttpException, HttpStatus } from "@nestjs/common";
import { ContentSizeBreakdown } from "./content-size";

export class ProjectNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export const PROJECT_TOO_LARGE_CODE = "PROJECT_TOO_LARGE";

/** 413 raised when a game's logical content exceeds the publishing budget. */
export class ProjectTooLargeException extends HttpException {
  constructor(
    readonly contentSize: ContentSizeBreakdown,
    readonly maxContentBytes: number
  ) {
    super(
      {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        error: "Payload Too Large",
        code: PROJECT_TOO_LARGE_CODE,
        message:
          `Project content is ${contentSize.total} bytes, ` +
          `above the ${maxContentBytes} bytes limit`,
        contentSize,
        maxContentBytes
      },
      HttpStatus.PAYLOAD_TOO_LARGE
    );
  }
}
