import { Router, type Request, type Response } from 'express';
import {
  ROLES, checkPassword, createSession, endSession, endUserSessions, findLogin, hashPassword, loginFailed, loginLocked, loginOk,
  publicUser, readToken, setCookie, verifyPassword, type Role, type User,
} from './auth.ts';
import type { Store } from './db.ts';
import { HttpError } from './api.ts';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const bad = (m: string) => new HttpError(400, m);

export function buildAuthApi(store: Store) {
  const r = Router();
  const h = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: any) => {
    try { res.json(fn(req, res) ?? { ok: true }); } catch (e) { next(e); }
  };
  const userCount = () => (store.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const adminCount = (exceptId = -1) => (store.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(exceptId) as { n: number }).n;
  const startSession = (req: Request, res: Response, u: User) => { setCookie(req, res, createSession(store, u.id)); return { user: u }; };

  const validate = (b: any, isNew: boolean) => {
    const out: Record<string, any> = {};
    if (isNew || 'username' in b) {
      const u = str(b.username).toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw bad('Usernames are 3-40 letters, digits, dots, dashes or underscores');
      out.username = u;
    }
    if (isNew || 'name' in b) { out.name = str(b.name); if (!out.name) throw bad('Enter the person\'s name'); }
    if (isNew || 'role' in b) { if (!ROLES.includes(b.role)) throw bad('Pick a role'); out.role = b.role as Role; }
    if ('teacherName' in b) {
      out.teacherName = str(b.teacherName) || null;
      if (out.teacherName && !store.db.prepare('SELECT 1 FROM teachers WHERE name = ?').get(out.teacherName)) throw bad('That teacher is not on the Teachers list');
    }
    if (isNew || b.password) { const e = checkPassword(b.password); if (e) throw bad(e); out.passwordHash = hashPassword(b.password); }
    if ('active' in b) out.active = b.active ? 1 : 0;
    if (out.role && out.role !== 'teacher') out.teacherName = null;
    return out;
  };

  // ------------------------------------------------------------ session
  r.get('/auth/status', h((req) => ({ needsSetup: userCount() === 0, user: req.user ?? null })));

  /** First run only: create the first admin account. */
  r.post('/auth/setup', h((req, res) => {
    if (userCount() > 0) throw new HttpError(403, 'The app is already set up: log in instead');
    const v = validate({ ...req.body, role: 'admin' }, true);
    const id = Number(store.db.prepare('INSERT INTO users (username, name, role, passwordHash, active, createdAt) VALUES (?, ?, ?, ?, 1, ?)')
      .run(v.username, v.name, 'admin', v.passwordHash, new Date().toISOString()).lastInsertRowid);
    return startSession(req, res, publicUser(store.db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
  }));

  r.post('/auth/login', h((req, res) => {
    const username = str(req.body?.username).toLowerCase();
    const key = `${username}|${req.ip}`;
    const wait = loginLocked(key);
    if (wait) throw new HttpError(429, `Too many wrong passwords. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
    const u = findLogin(store, username, String(req.body?.password ?? ''));
    if (!u) { loginFailed(key); throw new HttpError(401, 'Wrong username or password'); }
    loginOk(key);
    return startSession(req, res, publicUser(u));
  }));

  r.post('/auth/logout', h((req, res) => {
    const t = readToken(req);
    if (t) endSession(store, t);
    setCookie(req, res, null);
  }));

  r.put('/auth/password', h((req) => {
    if (!req.user) throw new HttpError(401, 'Log in first');
    const row = store.db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(req.user.id) as { passwordHash: string };
    if (!verifyPassword(String(req.body?.current ?? ''), row.passwordHash)) throw bad('Your current password is not right');
    const e = checkPassword(req.body?.password);
    if (e) throw bad(e);
    store.db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(hashPassword(req.body.password), req.user.id);
    endUserSessions(store, req.user.id, readToken(req) ?? undefined); // sign out everywhere else
  }));

  // ------------------------------------------------------------ users (admin only)
  r.use('/users', (req, _res, next) => next(req.perms?.admin ? undefined : new HttpError(req.user ? 403 : 401, req.user ? 'Only an admin can manage users' : 'Log in first')));

  r.get('/users', h(() => (store.db.prepare('SELECT * FROM users ORDER BY role, name').all() as any[]).map(publicUser)));

  r.post('/users', h((req) => {
    const v = validate(req.body ?? {}, true);
    if (store.db.prepare('SELECT 1 FROM users WHERE username = ?').get(v.username)) throw bad(`The username ${v.username} is taken`);
    const id = Number(store.db.prepare('INSERT INTO users (username, name, role, teacherName, passwordHash, active, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(v.username, v.name, v.role, v.teacherName ?? null, v.passwordHash, new Date().toISOString()).lastInsertRowid);
    return publicUser(store.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }));

  r.put('/users/:id', h((req) => {
    const id = +req.params.id;
    const cur = store.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!cur) throw new HttpError(404, 'User not found');
    const v = validate(req.body ?? {}, false);
    if (v.username && v.username !== cur.username && store.db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(v.username, id)) throw bad(`The username ${v.username} is taken`);
    const losesAdmin = cur.role === 'admin' && cur.active && ((v.role && v.role !== 'admin') || v.active === 0);
    if (losesAdmin && adminCount(id) === 0) throw bad('There must always be at least one active admin');
    const cols = Object.keys(v);
    if (cols.length) store.db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => v[c]), id);
    // a password reset, a new role or a deactivated account signs that person out
    if (v.passwordHash || v.role || v.active === 0) endUserSessions(store, id, id === req.user!.id ? readToken(req) ?? undefined : undefined);
    return publicUser(store.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }));

  r.delete('/users/:id', h((req) => {
    const id = +req.params.id;
    if (id === req.user!.id) throw bad('You cannot delete your own account');
    const cur = store.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!cur) throw new HttpError(404, 'User not found');
    if (cur.role === 'admin' && cur.active && adminCount(id) === 0) throw bad('There must always be at least one active admin');
    store.db.prepare('DELETE FROM sessions WHERE userId = ?').run(id);
    store.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }));

  return r;
}
