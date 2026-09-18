import { createHmac } from "node:crypto";

/**
 * Who is looking, for the purpose of counting a view once: a signed-in reader by id, anyone else
 * by a keyed hash of their address, so the address itself is never stored.
 */
export const viewerKeyOf = (
  userId: number | null,
  ip: string,
  secret: string
): string =>
  userId !== null
    ? `u:${userId}`
    : `ip:${createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32)}`;
