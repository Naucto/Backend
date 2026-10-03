import { withEnv } from '../../test/env';
import { BadEnvVarError, getEnv, getOptionalEnv, MissingEnvVarError } from './env';

describe('getEnv', () => {
  it('returns a text variable as set', () => {
    withEnv({ JWT_SECRET: 'secret' });
    expect(getEnv('JWT_SECRET')).toBe('secret');
  });

  it('refuses an unset variable', () => {
    withEnv({ JWT_SECRET: undefined });
    expect(() => getEnv('JWT_SECRET')).toThrow(MissingEnvVarError);
  });

  it('treats an empty variable as unset', () => {
    withEnv({ JWT_SECRET: '' });
    expect(() => getEnv('JWT_SECRET')).toThrow(MissingEnvVarError);
  });

  it('parses an integer, and refuses one with trailing text', () => {
    withEnv({ PORT: '3000' });
    expect(getEnv('PORT')).toBe(3000);
    withEnv({ PORT: '3000abc' });
    expect(() => getEnv('PORT')).toThrow(BadEnvVarError);
  });

  it('reads the variable again on every call', () => {
    withEnv({ PORT: '3000' });
    expect(getEnv('PORT')).toBe(3000);
    withEnv({ PORT: '4000' });
    expect(getEnv('PORT')).toBe(4000);
  });
});

describe('getOptionalEnv', () => {
  it('returns the fallback only when the variable is unset', () => {
    withEnv({ S3_MAX_CHECKPOINTS: undefined });
    expect(getOptionalEnv('S3_MAX_CHECKPOINTS', 20)).toBe(20);
    withEnv({ S3_MAX_CHECKPOINTS: '5' });
    expect(getOptionalEnv('S3_MAX_CHECKPOINTS', 20)).toBe(5);
  });

  it('returns undefined without a fallback', () => {
    withEnv({ BACKEND_WEBRTC_TURN_KEY_ID: undefined });
    expect(getOptionalEnv('BACKEND_WEBRTC_TURN_KEY_ID')).toBeUndefined();
  });

  it('still refuses a value that does not parse', () => {
    withEnv({ S3_MAX_CHECKPOINTS: 'many' });
    expect(() => getOptionalEnv('S3_MAX_CHECKPOINTS', 20)).toThrow(BadEnvVarError);
  });

  it('reads a flag as true/false or 1/0, and nothing else', () => {
    withEnv({ ENABLE_SWAGGER: 'false' });
    expect(getOptionalEnv('ENABLE_SWAGGER', true)).toBe(false);
    withEnv({ ENABLE_SWAGGER: '1' });
    expect(getOptionalEnv('ENABLE_SWAGGER', false)).toBe(true);
    withEnv({ ENABLE_SWAGGER: 'yes' });
    expect(() => getOptionalEnv('ENABLE_SWAGGER', true)).toThrow(BadEnvVarError);
  });
});
