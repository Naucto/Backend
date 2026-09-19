import { HttpException, HttpStatus } from "@nestjs/common";
import { ContentSizeBreakdown } from "./content-size";

export class ProjectNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export const PROJECT_NOT_PUBLISHED_CODE = "PROJECT_NOT_PUBLISHED";

/** 400 raised when a release is asked of a project that has none on the hub. */
export class ProjectNotPublishedException extends HttpException {
  constructor(projectId: number) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: "Bad Request",
        code: PROJECT_NOT_PUBLISHED_CODE,
        message: `Project with ID ${projectId} is not published`
      },
      HttpStatus.BAD_REQUEST
    );
  }
}

export const CHECKPOINT_LIMIT_CODE = "CHECKPOINT_LIMIT";

/** 400 raised when a project holds as many named versions as it may, and the name is new. */
export class CheckpointLimitException extends HttpException {
  constructor(
    readonly count: number,
    readonly max: number
  ) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: "Bad Request",
        code: CHECKPOINT_LIMIT_CODE,
        message: `${count} versions out of ${max} - delete one to save another`,
        count,
        max
      },
      HttpStatus.BAD_REQUEST
    );
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
