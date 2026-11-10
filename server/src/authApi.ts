import { Router, type Request, type Response } from 'express';
import {
  ROLES, PORTAL_ROLES, learnersOf, checkPassword, createSession, endSession, endUserSessions, findLogin, hashPassword, loginFailed, loginLocked, loginOk,
  publicUser, readToken, setCookie, verifyPassword, type Role, type User,
} from './auth.ts';
import type { Store } from './db.ts';
import { HttpError } from './api.ts';
import { logActivity } from './activity.ts';

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
  const as = (u: User) => ({ id: u.id, name: u.name, role: u.role });
  const ROLE = { admin: 'Admin', teacher: 'Teacher', bursar: 'Bursar', librarian: 'Librarian', parent: 'Parent', student: 'Student' } as Record<string, string>;
  const describeUser = (u: any) => `${u.name} (@${u.username}, ${ROLE[u.role] ?? u.role}${u.teacherName ? `, ${u.teacherName}` : ''})`;

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
  /** Parent: one or more learners; student: exactly one. Returns null when not a portal role. */
  const learnerLinks = (role: string, ids: unknown): number[] | null => {
    if (!PORTAL_ROLES.includes(role as Role)) return null;
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    for (const id of list) if (!store.db.prepare('SELECT 1 FROM students WHERE id = ?').get(id)) throw bad(`Learner #${id} does not exist`);
    if (role === 'student' && list.length !== 1) throw bad('A student login is linked to exactly one learner');
    if (role === 'parent' && !list.length) throw bad('Pick the learner(s) this parent can see');
    return list;
  };
  const setLinks = (userId: number, ids: number[] | null) => {
    store.db.prepare('DELETE FROM userLearners WHERE userId = ?').run(userId);
    for (const id of ids ?? []) store.db.prepare('INSERT INTO userLearners (userId, learnerId) VALUES (?, ?)').run(userId, id);
  };
  const withLinks = (u: User) => ({ ...u, learnerIds: learnersOf(store, u.id) });
  const learnerNames = (ids: number[]) => ids.map((id) => {
    const st = store.db.prepare('SELECT firstName, lastName FROM students WHERE id = ?').get(id) as any;
    return st ? `${st.firstName} ${st.lastName}` : `#${id}`;
  }).join(', ');

  // ------------------------------------------------------------ session
  r.get('/auth/status', h((req) => ({ needsSetup: userCount() === 0, user: req.user ?? null })));

  /** First run only: create the first admin account. */
  r.post('/auth/setup', h((req, res) => {
    if (userCount() > 0) throw new HttpError(403, 'The app is already set up: log in instead');
    const v = validate({ ...req.body, role: 'admin' }, true);
    const id = Number(store.db.prepare('INSERT INTO users (username, name, role, passwordHash, active, createdAt) VALUES (?, ?, ?, ?, 1, ?)')
      .run(v.username, v.name, 'admin', v.passwordHash, new Date().toISOString()).lastInsertRowid);
    const u = publicUser(store.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    logActivity(store, req, { category: 'users', action: 'setup', summary: `Set up the app: created the first admin account ${describeUser(u)}` }, as(u));
    return startSession(req, res, u);
  }));

  r.post('/auth/login', h((req, res) => {
    const username = str(req.body?.username).toLowerCase();
    const key = `${username}|${req.ip}`;
    const wait = loginLocked(key);
    if (wait) {
      logActivity(store, req, { category: 'auth', action: 'login.locked', summary: `Login refused for "${username}": locked after too many wrong passwords` }, { id: null, name: username || '(blank)' });
      throw new HttpError(429, `Too many wrong passwords. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
    }
    const u = findLogin(store, username, String(req.body?.password ?? ''));
    if (!u) {
      loginFailed(key);
      const known = store.db.prepare('SELECT id, name, role FROM users WHERE username = ?').get(username) as any;
      logActivity(store, req, { category: 'auth', action: 'login.failed', summary: known ? `Failed login for @${username}: wrong password` : `Failed login: no user called "${username.slice(0, 40)}"` },
        known ? { id: known.id, name: known.name, role: known.role } : { id: null, name: username.slice(0, 40) || '(blank)' });
      throw new HttpError(401, 'Wrong username or password');
    }
    loginOk(key);
    logActivity(store, req, { category: 'auth', action: 'login', summary: `Logged in` }, as(u));
    return startSession(req, res, publicUser(u));
  }));

  r.post('/auth/logout', h((req, res) => {
    const t = readToken(req);
    if (t) endSession(store, t);
    if (req.user) logActivity(store, req, { category: 'auth', action: 'logout', summary: 'Logged out' });
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
    logActivity(store, req, { category: 'auth', action: 'password.change', summary: 'Changed their own password' });
  }));

  // ------------------------------------------------------------ users (admin only)
  r.use('/users', (req, _res, next) => next(req.perms?.admin ? undefined : new HttpError(req.user ? 403 : 401, req.user ? 'Only an admin can manage users' : 'Log in first')));

  r.get('/users', h(() => (store.db.prepare('SELECT * FROM users ORDER BY role, name').all() as any[]).map((u) => withLinks(publicUser(u)))));

  r.post('/users', h((req) => {
    const v = validate(req.body ?? {}, true);
    if (store.db.prepare('SELECT 1 FROM users WHERE username = ?').get(v.username)) throw bad(`The username ${v.username} is taken`);
    const links = learnerLinks(v.role, req.body?.learnerIds);
    const id = Number(store.db.prepare('INSERT INTO users (username, name, role, teacherName, passwordHash, active, createdAt) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(v.username, v.name, v.role, v.teacherName ?? null, v.passwordHash, new Date().toISOString()).lastInsertRowid);
    setLinks(id, links);
    const u = publicUser(store.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    logActivity(store, req, { category: 'users', action: 'user.create', summary: `Added user ${describeUser(u)}${links ? ` for ${learnerNames(links)}` : ''}` });
    return withLinks(u);
  }));

  r.put('/users/:id', h((req) => {
    const id = +req.params.id;
    const cur = store.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!cur) throw new HttpError(404, 'User not found');
    const v = validate(req.body ?? {}, false);
    if (v.username && v.username !== cur.username && store.db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(v.username, id)) throw bad(`The username ${v.username} is taken`);
    const role = v.role ?? cur.role;
    const oldLinks = learnersOf(store, id);
    const links = 'learnerIds' in (req.body ?? {}) || v.role ? learnerLinks(role, req.body?.learnerIds ?? oldLinks) : PORTAL_ROLES.includes(role) ? oldLinks : null;
    const losesAdmin = cur.role === 'admin' && cur.active && ((v.role && v.role !== 'admin') || v.active === 0);
    if (losesAdmin && adminCount(id) === 0) throw bad('There must always be at least one active admin');
    const cols = Object.keys(v);
    if (cols.length) store.db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => v[c]), id);
    setLinks(id, links);
    // a password reset, a new role or a deactivated account signs that person out
    if (v.passwordHash || v.role || v.active === 0) endUserSessions(store, id, id === req.user!.id ? readToken(req) ?? undefined : undefined);
    const u = publicUser(store.db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    const what: string[] = [];
    for (const [k, label] of [['username', 'username'], ['name', 'name'], ['role', 'role'], ['teacherName', 'linked teacher']] as const)
      if ((cur[k] ?? null) !== ((u as any)[k] ?? null)) what.push(`${label} ${cur[k] ?? '–'} → ${(u as any)[k] ?? '–'}`);
    if (cur.active !== u.active) what.push(u.active ? 'enabled the account' : 'disabled the account');
    if (v.passwordHash) what.push('reset the password');
    if (JSON.stringify(oldLinks) !== JSON.stringify(links ?? [])) what.push(`learners: ${learnerNames(links ?? []) || 'none'}`);
    if (what.length) logActivity(store, req, { category: 'users', action: 'user.update', summary: `Changed user ${cur.name}: ${what.join(', ')}` });
    return withLinks(u);
  }));

  r.delete('/users/:id', h((req) => {
    const id = +req.params.id;
    if (id === req.user!.id) throw bad('You cannot delete your own account');
    const cur = store.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!cur) throw new HttpError(404, 'User not found');
    if (cur.role === 'admin' && cur.active && adminCount(id) === 0) throw bad('There must always be at least one active admin');
    store.db.prepare('DELETE FROM sessions WHERE userId = ?').run(id);
    store.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logActivity(store, req, { category: 'users', action: 'user.delete', summary: `Deleted user ${describeUser(cur)}` });
  }));

  return r;
}
