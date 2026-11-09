export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

/** Fired when the session has ended (logged out elsewhere, expired, password reset): the app shows the login screen. */
export const AUTH_EVENT = 'school:auth-required';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    // the server refuses changing requests without this header, so other sites cannot post forms here
    headers: { 'X-Requested-With': 'fetch', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(AUTH_EVENT));
    if (data?.error) throw new ApiError(data.error, res.status);
    // no JSON: the dev proxy could not reach the API server (it answers 500 / 502 / 504 with plain text)
    if (res.status >= 500) throw new ApiError('The API server is not answering. Look in the terminal where you ran "npm run dev" for an error on the [api] lines.', res.status);
    throw new ApiError(`Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T = any>(path: string) => call<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => call<T>('POST', path, body ?? {}),
  put: <T = any>(path: string, body: unknown) => call<T>('PUT', path, body),
  del: <T = any>(path: string) => call<T>('DELETE', path),
};

export const qs = (o: Record<string, string | number | undefined | null>) =>
  '?' + Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
