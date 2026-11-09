import type { Express } from 'express';
import type { AddressInfo } from 'node:net';

export type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any; cookies: string[] }>;

/** An HTTP client for the app that keeps its session cookie, like a browser tab. */
export function client(app: Express, opts: { csrfHeader?: boolean } = {}): Call {
  let cookie = '';
  return async (method, path, body) => {
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const headers: Record<string, string> = {};
      if (opts.csrfHeader !== false) headers['X-Requested-With'] = 'fetch';
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      const cookies = res.headers.getSetCookie();
      for (const c of cookies) {
        const [kv] = c.split(';');
        cookie = kv.endsWith('=') ? '' : kv; // "sid=" clears it
      }
      return { status: res.status, body: await res.json().catch(() => null), cookies };
    } finally {
      server.close();
    }
  };
}

const admins = new WeakMap<Express, Call>();
/** Call the app as its admin (set up on first use). */
export default async function request(app: Express, method: string, path: string, body?: unknown) {
  let call = admins.get(app);
  if (!call) {
    call = client(app);
    const r = await call('POST', '/api/auth/setup', { username: 'admin', name: 'Admin', password: 'admin-pass-1' });
    if (r.status !== 200) throw new Error(`setup failed: ${JSON.stringify(r.body)}`);
    admins.set(app, call);
  }
  return call(method, path, body);
}
