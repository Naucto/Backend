import { TransformFnParams } from 'class-transformer';

export const trimmed = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** A query string holds text, so `?withComments=false` must not read as a truthy string. */
export const queryBoolean = ({ value }: TransformFnParams): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;
