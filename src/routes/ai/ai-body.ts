import express, { NextFunction, Request, Response } from 'express';

/** A whole game state in base64: the project blob limit (16 MiB) and a third more. */
const aiJson = express.json({ limit: '24mb' });

/**
 * The body parser of the `/ai` routes, which carry whole game states and so take bodies larger
 * than Nest's default.
 *
 * Named on purpose: Nest skips its own JSON parser when it finds an Express layer called
 * `jsonParser`, so an anonymous `express.json()` would leave every other route without a body.
 */
export function aiJsonParser(req: Request, res: Response, next: NextFunction): void {
  aiJson(req, res, next);
}
