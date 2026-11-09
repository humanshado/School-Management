export class ApiError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`);
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
