/** Raised when a lifetime does not read as a time span such as `15m` or `7d`. */
export class BadTimeSpanError extends Error {
  constructor(value: string) {
    super(`Not a time span: ${value}`);
    this.name = this.constructor.name;
  }
}

/** Raised when a refresh cookie is too short to be one this server encrypted. */
export class MalformedRefreshCookieError extends Error {
  constructor() {
    super('Malformed refresh token cookie');
    this.name = this.constructor.name;
  }
}
