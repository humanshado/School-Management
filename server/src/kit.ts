/** Small helpers shared by the routers: JSON handlers, role checks, input cleaning. */
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './api.ts';
import type { Perms } from './auth.ts';

export { HttpError };
export const bad = (m: string) => new HttpError(400, m);
export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const forbidden = (m: string) => new HttpError(403, m);

/** Wrap a handler: its return value is sent as JSON (or {ok:true}); thrown errors go to the error handler. */
export const h = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) { next(e); }
};

type Flag = 'admin' | 'teach' | 'fees' | 'library' | 'transport' | 'hr' | 'admissions' | 'staff' | 'portal';
const WHO: Record<Flag, string> = {
  admin: 'an admin', teach: 'teachers and admins', fees: 'the bursar and admins', library: 'the librarian and admins',
  transport: 'admins', hr: 'admins and the bursar', admissions: 'admins', staff: 'staff', portal: 'parents and students',
};
export const need = (req: Request, what: Flag) => { if (!req.perms?.[what]) throw forbidden(`Only ${WHO[what]} can do that`); };
export const mayTeach = (p: Perms | undefined, cls: string) => !!p?.teach && (!p.classes || p.classes.includes(cls));
export const needClass = (req: Request, cls: string) => {
  need(req, 'teach');
  const c = req.perms!.classes;
  if (c && !c.includes(cls)) throw forbidden(c.length ? `You can only work on ${c.length === 1 ? `your class (${c[0]})` : `your classes (${c.join(', ')})`}` : 'You are not class teacher of any class yet: ask an admin');
};

export const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
export const num = (v: unknown) => (v === undefined || v === null || v === '' ? NaN : Number(v));
export const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const nowIso = () => new Date().toISOString();
/** Keep only the listed keys of a request body. */
export const pick = (b: any, keys: readonly string[]): Record<string, any> => Object.fromEntries(keys.filter((k) => b && k in b).map((k) => [k, b[k]]));
