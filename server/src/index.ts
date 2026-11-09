import './preflight.ts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { openStore } from './db.ts';

const here = dirname(fileURLToPath(import.meta.url));
const store = openStore();
const port = Number(process.env.PORT ?? 3001);
// npm start serves the built web app too; in development Vite serves it
const serveClient = process.argv.includes('--serve-client') || process.env.NODE_ENV === 'production';
const dist = serveClient ? resolve(here, '../../client/dist') : undefined;

const server = createApp(store, dist).listen(port, () => {
  console.log(`School Management API on http://localhost:${port}${dist ? ' (serving the built app)' : ''}`);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${port} is already in use: is the app already running in another terminal?`);
    console.error(`Close it, or run on another port (and point client/vite.config.ts at it).\n`);
    process.exit(1);
  }
  throw e;
});
