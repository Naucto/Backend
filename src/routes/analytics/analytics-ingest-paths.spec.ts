import express from 'express';
import request from 'supertest';

import { useTextJsonParser } from './analytics-ingest-paths';

describe('useTextJsonParser', () => {
  const appWith = (): express.Express => {
    const app = express();
    useTextJsonParser(app);
    return app;
  };

  it('leaves no middleware named jsonParser, so Nest still mounts its own JSON parser', () => {
    const app = appWith();
    const names = (
      app.router as unknown as { stack: Array<{ handle: { name: string } }> }
    ).stack.map((layer) => layer.handle.name);

    expect(names).not.toContain('jsonParser');
  });

  it('parses a text/plain body as JSON on an ingest route', async () => {
    const app = appWith();
    app.post('/analytics/beat', (req, res) => {
      res.json(req.body);
    });

    const response = await request(app)
      .post('/analytics/beat')
      .set('Content-Type', 'text/plain')
      .send('{"state":"BROWSING"}');

    expect(response.body).toEqual({ state: 'BROWSING' });
  });

  it('leaves other routes to the parsers mounted after it', async () => {
    const app = appWith();
    app.use(express.json());
    app.post('/auth/login', (req, res) => {
      res.json(req.body);
    });

    const response = await request(app).post('/auth/login').send({ email: 'a@b.c' });

    expect(response.body).toEqual({ email: 'a@b.c' });
  });
});
