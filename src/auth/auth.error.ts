export class MissingEnvVarError extends Error {
  constructor(varName: string) {
    super(`${varName} environment variable is not set`);
    this.name = this.constructor.name;
  }
}

export class BadEnvVarError extends Error {
  constructor(varName: string) {
    super(`${varName} environment variable has an invalid value`);
    this.name = this.constructor.name;
  }
}

export class CloudfrontSignedCookiesException extends Error {
  constructor(public readonly cookies: Record<string, string | undefined>) {
    super(`Signed cookies are incomplete: ${JSON.stringify(cookies)}`);
    this.name = this.constructor.name;
  }
}
