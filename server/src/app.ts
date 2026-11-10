import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApi, HttpError } from './api.ts';
import { authenticate, initAuth, sameOriginOnly } from './auth.ts';
import { initActivity } from './activity.ts';
import { buildFilesApi } from './files.ts';
import { buildLearningApi } from './learning.ts';
import { buildPortalApi } from './portal.ts';
import { buildAuthApi } from './authApi.ts';
import type { Store } from './db.ts';

export function createApp(store: Store, clientDist?: string) {
  initAuth(store);
  initActivity(store);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', authenticate(store), sameOriginOnly);
  app.use('/api', buildAuthApi(store));
  // everything else needs a login
  app.use('/api', (req, _res, next) => next(req.user ? undefined : new HttpError(401, 'Please log in')));
  app.use('/api', buildFilesApi(store)); // own checks per kind of file (families may open homework files)
  app.use('/api/portal', buildPortalApi(store));
  // parents and students stop here: everything below is for staff
  app.use('/api', (req, _res, next) => next(req.perms?.staff ? undefined : new HttpError(403, 'This part of the app is for school staff')));
  app.use('/api', buildLearningApi(store));
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
