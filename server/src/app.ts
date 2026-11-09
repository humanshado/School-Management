import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApi, HttpError } from './api.ts';
import type { Store } from './db.ts';

export function createApp(store: Store, clientDist?: string) {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api', buildApi(store));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'No such API route')));
  if (clientDist && existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
  }
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err instanceof HttpError ? err.status : err.type === 'entity.parse.failed' ? 400 : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong on the server' : err.message });
  });
  return app;
}
