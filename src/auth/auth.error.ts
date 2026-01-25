export class MissingEnvVarError extends Error {
  constructor(varName: string) {
    super(`${varName} environment variable is not set`);
    this.name = "MissingEnvVarError";
  }
}

export class BadEnvVarError extends Error {
  constructor(varName: string) {
    super(`${varName} environment variable has an invalid value`);
    this.name = "BadEnvVarError";
  }
}

export class CloudfrontSignedCookiesException extends Error {
  constructor(public readonly cookies: Record<string, string | undefined>) {
    super(`Signed cookies are incomplete: ${JSON.stringify(cookies)}`);
    this.name = "CloudfrontSignedCookiesException";
  }
}
