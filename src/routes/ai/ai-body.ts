import express, { NextFunction, Request, Response } from "express";

const aiJson = express.json({ limit: "24mb" });

/**
 * Body parser for the AI routes. Editor snapshots are whole Yjs states, bounded by the project blob
 * limit (16 MiB) in base64, so these routes take bodies larger than Nest's default.
 *
 * Named on purpose: Nest skips its own global JSON parser when it finds an Express layer called
 * `jsonParser`, so mounting an anonymous `express.json()` would silently leave every other route
 * without a body.
 */
export function aiJsonParser(req: Request, res: Response, next: NextFunction): void {
  aiJson(req, res, next);
}
