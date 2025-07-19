export class MissingEnvVarError extends Error {
  constructor(varName: string) {
    super(`${varName} environment variable is not set`);
    this.name = "MissingEnvVarError";
  }
}
