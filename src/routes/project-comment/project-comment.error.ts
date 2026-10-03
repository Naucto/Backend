import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

export class CommentNotFoundException extends NotFoundException {
  constructor(commentId: number) {
    super(`Comment with ID ${commentId} not found`);
  }
}

/** Also raised for a draft when reading: comments on a project the hub does not carry stay hidden. */
export class CommentProjectNotFoundException extends NotFoundException {
  constructor(projectId: number) {
    super(`Project with ID ${projectId} not found`);
  }
}

/** A comment addressed through a project it is not on. */
export class CommentNotInProjectException extends NotFoundException {
  constructor() {
    super('Comment does not belong to this project');
  }
}

export class CommentProjectNotPublishedException extends BadRequestException {
  constructor(projectId: number) {
    super(`Project with ID ${projectId} is not published`);
  }
}

export class CommentNestedReplyException extends BadRequestException {
  constructor() {
    super('Cannot reply to a reply. Only top-level comments can receive replies.');
  }
}

export class CommentReplyToDeletedException extends ForbiddenException {
  constructor() {
    super('Cannot reply to a deleted comment');
  }
}

export class CommentNotAuthorException extends ForbiddenException {
  constructor(action: 'edit' | 'delete') {
    super(`You can only ${action} your own comments`);
  }
}
