/**
 * Logins, sessions and roles.
 *
 *   admin    everything
 *   teacher  registers, gradebook and the teacher's report-card comment — for the classes where the linked
 *            teacher is class teacher (a teacher login with no linked teacher may work on every class);
 *            sees learners and classes but no fee figures
 *   bursar   fees, receipts, payment plans and fee reminders; sees learners and classes
 *
 * Passwords: scrypt with a random salt. Sessions: a random token in an HttpOnly cookie; only its SHA-256 is stored.
 * Requests that change something must carry "X-Requested-With: fetch" (a page on another site cannot add it).
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Store } from './db.ts';

export type Role = 'admin' | 'teacher' | 'bursar' | 'librarian' | 'parent' | 'student';
export const ROLES: Role[] = ['admin', 'teacher', 'bursar', 'librarian', 'parent', 'student'];
/** Parents and students only see the portal, for the learners linked to their login. */
export const PORTAL_ROLES: Role[] = ['parent', 'student'];

export interface User { id: number; username: string; name: string; role: Role; teacherName: string | null; active: number }

export interface Perms {
  role: Role;
  admin: boolean;
  /** a member of staff (every role but parent and student) */
  staff: boolean;
  /** take registers / enter marks / teacher comments / homework */
  teach: boolean;
  /** see and record fees */
  fees: boolean;
  library: boolean;
  transport: boolean;
  /** staff records, staff attendance, leave and payroll */
  hr: boolean;
  admissions: boolean;
  /** parent / student portal */
  portal: boolean;
  /** classes a teacher may work on; null = every class */
  classes: string[] | null;
  /** learners a parent / student login may see */
  learners: number[];
}

declare global {
  namespace Express {
    interface Request { user?: User; perms?: Perms }
  }
}

const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'sid';

export function initAuth(store: Store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL,
      teacherName TEXT, passwordHash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS userLearners (
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, learnerId INTEGER NOT NULL, PRIMARY KEY (userId, learnerId)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash TEXT PRIMARY KEY, userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
    );`);
}

// ------------------------------------------------------------ passwords
export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'hex');
  const got = scryptSync(pw, Buffer.from(salt, 'hex'), want.length);
  return timingSafeEqual(want, got);
}
export function checkPassword(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Passwords need at least 8 characters';
  if (pw.length > 200) return 'That password is too long';
  return null;
}
/** Used when a username does not exist, so a wrong username takes as long as a wrong password. */
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));

// ------------------------------------------------------------ sessions
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export function createSession(store: Store, userId: number) {
  const token = randomBytes(32).toString('base64url');
  store.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  store.db.prepare('INSERT INTO sessions (tokenHash, userId, expires) VALUES (?, ?, ?)').run(sha(token), userId, Date.now() + SESSION_IDLE_MS);
  return token;
}
export const endSession = (store: Store, token: string) => store.db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(sha(token));
export const endUserSessions = (store: Store, userId: number, keepToken?: string) =>
  store.db.prepare('DELETE FROM sessions WHERE userId = ? AND tokenHash != ?').run(userId, keepToken ? sha(keepToken) : '');

export function readToken(req: Request): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}
export function setCookie(req: Request, res: Response, token: string | null) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', ...(req.secure ? ['Secure'] : [])];
  res.append('Set-Cookie', token
    ? `${COOKIE}=${token}; ${attrs.join('; ')}; Max-Age=${Math.floor(SESSION_IDLE_MS / 1000)}`
    : `${COOKIE}=; ${attrs.join('; ')}; Max-Age=0`);
}

export function permsFor(store: Store, u: User): Perms {
  let classes: string[] | null = null;
  if (u.role === 'teacher' && u.teacherName) {
    classes = (store.db.prepare('SELECT name FROM classes WHERE teacher = ? ORDER BY name').all(u.teacherName) as { name: string }[]).map((c) => c.name);
  }
  const r = u.role, admin = r === 'admin', portal = PORTAL_ROLES.includes(r);
  return {
    role: r, admin, staff: !portal, portal,
    teach: admin || r === 'teacher', fees: admin || r === 'bursar', library: admin || r === 'librarian',
    transport: admin, hr: admin || r === 'bursar', admissions: admin,
    classes: admin ? null : classes,
    learners: portal ? learnersOf(store, u.id) : [],
  };
}

/** Attach req.user / req.perms from the session cookie (sliding expiry). */
export function authenticate(store: Store) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = readToken(req);
    if (token) {
      const row = store.db.prepare(`SELECT u.id, u.username, u.name, u.role, u.teacherName, u.active, s.expires FROM sessions s
        JOIN users u ON u.id = s.userId WHERE s.tokenHash = ?`).get(sha(token)) as (User & { expires: number }) | undefined;
      if (row && row.active && row.expires > Date.now()) {
        const { expires, ...user } = row;
        req.user = user;
        req.perms = permsFor(store, user);
        // slide the expiry at most once a minute
        if (expires - Date.now() < SESSION_IDLE_MS - 60_000) {
          store.db.prepare('UPDATE sessions SET expires = ? WHERE tokenHash = ?').run(Date.now() + SESSION_IDLE_MS, sha(token));
          setCookie(req, res, token);
        }
      } else if (row) {
        endSession(store, token);
      }
    }
    next();
  };
}

/** Changing requests must come from this app's own pages. */
export function sameOriginOnly(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.get('x-requested-with') === 'fetch') return next();
  res.status(403).json({ error: 'Request blocked: it did not come from the app' });
}

// ------------------------------------------------------------ login throttle
const fails = new Map<string, { n: number; until: number }>();
const MAX_FAILS = 5, LOCK_MS = 5 * 60 * 1000;

export function loginLocked(key: string) {
  const f = fails.get(key);
  if (f && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60000);
  return 0;
}
export function loginFailed(key: string) {
  const f = fails.get(key) ?? { n: 0, until: 0 };
  f.n = f.until && f.until < Date.now() ? 1 : f.n + 1;
  f.until = f.n >= MAX_FAILS ? Date.now() + LOCK_MS : 0;
  fails.set(key, f);
}
export const loginOk = (key: string) => fails.delete(key);

export function findLogin(store: Store, username: string, password: string): User | null {
  const row = store.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as (User & { passwordHash: string }) | undefined;
  const ok = verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);
  if (!row || !ok || !row.active) return null;
  const { passwordHash, ...user } = row;
  return user;
}

export const publicUser = (u: any): User => ({ id: u.id, username: u.username, name: u.name, role: u.role, teacherName: u.teacherName ?? null, active: u.active });

export const learnersOf = (store: Store, userId: number) =>
  (store.db.prepare('SELECT learnerId FROM userLearners WHERE userId = ? ORDER BY learnerId').all(userId) as { learnerId: number }[]).map((r) => r.learnerId);
