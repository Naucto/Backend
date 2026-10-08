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

type Parser<T> = (raw: string, key: string) => T;

const text: Parser<string> = (raw) => raw;

const integer: Parser<number> = (raw, key) => {
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new BadEnvVarError(key);
  }
  return Number(raw);
};

const flag: Parser<boolean> = (raw, key) => {
  switch (raw.trim().toLowerCase()) {
    case 'true':
    case '1':
      return true;
    case 'false':
    case '0':
      return false;
    default:
      throw new BadEnvVarError(key);
  }
};

/** Every variable the server reads, with the type it is read as; `.env.example` documents each. */
const ENV = {
  NODE_ENV: text,
  PORT: integer,
  FRONTEND_URL: text,

  DATABASE_URL: text,
  POSTGRES_USER: text,
  POSTGRES_PASSWORD: text,
  POSTGRES_DB: text,
  POSTGRES_PORT: integer,

  JWT_SECRET: text,
  VIEW_HASH_SECRET: text,
  JWT_EXPIRES_IN: text,
  JWT_REFRESH_EXPIRES_IN: text,
  REFRESH_TOKEN_ENCRYPTION_KEY: text,

  GOOGLE_CLIENT_ID: text,
  GOOGLE_CLIENT_SECRET: text,
  GOOGLE_REDIRECT_URI: text,
  GITHUB_CLIENT_ID: text,
  GITHUB_CLIENT_SECRET: text,
  MICROSOFT_CLIENT_ID: text,
  MICROSOFT_TENANT_ID: text,

  S3_ACCESS_KEY_ID: text,
  S3_SECRET_ACCESS_KEY: text,
  S3_ENDPOINT: text,
  S3_REGION: text,
  S3_BUCKET_NAME: text,
  S3_MAX_AUTO_HISTORY_VERSION: integer,
  S3_AUTO_HISTORY_DELAY: integer,
  S3_MAX_CHECKPOINTS: integer,
  EDGE_ENDPOINT: text,

  BACKEND_WEBRTC_HOSTNAME: text,
  BACKEND_WEBRTC_PORT_BASE: integer,
  BACKEND_WEBRTC_PORT_END: integer,
  BACKEND_WEBRTC_PUBLIC_URL_TEMPLATE: text,
  BACKEND_WEBRTC_TURN_KEY_ID: text,
  BACKEND_WEBRTC_TURN_API_TOKEN: text,

  GEOIP_DB_PATH: text,

  ENABLE_SWAGGER: flag,
} satisfies Record<string, Parser<unknown>>;

export type EnvKey = keyof typeof ENV;
export type EnvValue<K extends EnvKey> = ReturnType<(typeof ENV)[K]>;

/** An empty variable counts as unset: compose passes `KEY=` through as "". */
function readRaw(key: EnvKey): string | undefined {
  const raw = process.env[key];
  return raw === undefined || raw === '' ? undefined : raw;
}

/** Throws MissingEnvVarError when unset, BadEnvVarError when the value does not parse. */
export function getEnv<K extends EnvKey>(key: K): EnvValue<K> {
  const raw = readRaw(key);
  if (raw === undefined) {
    throw new MissingEnvVarError(key);
  }
  return ENV[key](raw, key) as EnvValue<K>;
}

/** The fallback when unset; a value that does not parse still throws BadEnvVarError. */
export function getOptionalEnv<K extends EnvKey>(key: K, fallback: EnvValue<K>): EnvValue<K>;
export function getOptionalEnv<K extends EnvKey>(key: K): EnvValue<K> | undefined;
export function getOptionalEnv<K extends EnvKey>(
  key: K,
  fallback?: EnvValue<K>,
): EnvValue<K> | undefined {
  const raw = readRaw(key);
  if (raw === undefined) {
    return fallback;
  }
  return ENV[key](raw, key) as EnvValue<K>;
}
