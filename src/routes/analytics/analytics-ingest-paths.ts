import express, { NextFunction, Request, RequestHandler, Response } from 'express';

/** The routes that accept a JSON body sent as text/plain. */
export const ANALYTICS_INGEST_PATHS = ['/analytics', '/projects/releases/:id/view'];

const parseTextJson = express.json({ type: 'text/plain', limit: '32kb' });

/**
 * Parses JSON sent as text/plain on the routes browsers report usage to. Wrapped under its own
 * name: Nest skips registering its application/json parser when a middleware named `jsonParser`
 * is already mounted, which express.json() is.
 */
export function useTextJsonParser(app: {
  use(paths: string[], handler: RequestHandler): unknown;
}): void {
  app.use(
    ANALYTICS_INGEST_PATHS,
    function textPlainJsonParser(req: Request, res: Response, next: NextFunction): void {
      parseTextJson(req, res, next);
    },
  );
}
