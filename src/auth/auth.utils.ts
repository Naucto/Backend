import { BadEnvVarError } from "./auth.error";

type TimeSpanUnit = "s" | "m" | "h" | "d" | "w" | "y";
type TimeSpanString = `${number}${TimeSpanUnit}`;
export type TimeSpan = number | TimeSpanString;

export function isStringValue(value: string): value is TimeSpanString {
  return /^\d+(s|m|h|d|w|y)$/.test(value);
}

export function parseExpiresIn(
  value: string | undefined,
  defaultValue: TimeSpan
): TimeSpan {
  if (!value) return defaultValue;

  if (isStringValue(value)) {
    return value;
  }

  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) {
    return asNumber;
  }

  throw new BadEnvVarError("JWT_EXPIRES_IN");
}

export function timespanToMs(value: TimeSpan): number {
  if (typeof value === "number") {
    return value * 1000;
  }

  const match = value.match(/^(\d+)(s|m|h|d|w|y)$/);
  if (!match) {
    throw new BadEnvVarError("JWT_EXPIRES_IN");
  }

  const amount = Number(match[1]);
  const unit = match[2] as TimeSpanUnit;

  const multipliers: Record<TimeSpanUnit, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000
  };

  return amount * multipliers[unit];
}
