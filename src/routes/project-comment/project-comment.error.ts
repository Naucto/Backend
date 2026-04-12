import { NotFoundException, BadRequestException } from "@nestjs/common";

export class CommentNotFoundException extends NotFoundException {
  constructor(commentId: number) {
    super(`Comment with ID ${commentId} not found`);
  }
}

export class CommentProjectNotPublishedException extends BadRequestException {
  constructor(projectId: number) {
    super(`Project with ID ${projectId} is not published`);
  }
}

export class CommentNestedReplyException extends BadRequestException {
  constructor() {
    super("Cannot reply to a reply. Only top-level comments can receive replies.");
  }
}
