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
