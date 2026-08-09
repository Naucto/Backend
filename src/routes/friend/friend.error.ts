export class FriendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class FriendRequestNotFoundError extends FriendError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class FriendshipNotFoundError extends FriendError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AlreadyFriendsError extends FriendError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class FriendRequestAlreadyExistsError extends FriendError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class CannotFriendYourselfError extends FriendError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UnauthorizedFriendActionError extends FriendError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
