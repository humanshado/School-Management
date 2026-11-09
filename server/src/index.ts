import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { openStore } from './db.ts';

const here = dirname(fileURLToPath(import.meta.url));
const store = openStore();
const port = Number(process.env.PORT ?? 3001);
const dist = process.env.NODE_ENV === 'production' ? resolve(here, '../../client/dist') : undefined;

createApp(store, dist).listen(port, () => {
  console.log(`School Management API on http://localhost:${port}${dist ? ' (serving the built app)' : ''}`);
});
