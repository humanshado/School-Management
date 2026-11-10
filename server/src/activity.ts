/**
 * ACTIVITY LOG — who changed what, and when.
 *
 * Every change made through the app is appended here: registers, marks, comments, learners, classes, teachers,
 * payments, payment plans, settings, users, backups, and logins / logouts (failed logins too).
 * Each entry keeps who did it (their name and role at the time), when, from which address, a plain-English summary,
 * and the details (before -> after values; a full copy of anything deleted).
 *
 * The app never edits or deletes entries, and "Clear data", "Load sample data" and "Restore backup" leave the log alone.
 * (Anyone with the database file itself can of course still change it: keep backups of the file somewhere safe.)
 */
import type { Request } from 'express';
import type { Store } from './db.ts';

export const CATEGORIES = {
  auth: 'Logins',
  users: 'Users',
  students: 'Learners',
  classes: 'Classes',
  teachers: 'Teachers',
  attendance: 'Attendance',
  grades: 'Gradebook',
  reports: 'Report cards',
  fees: 'Fees',
  settings: 'Settings',
  timetable: 'Timetable & exams',
  admissions: 'Admissions',
  library: 'Library',
  transport: 'Transport',
  hr: 'Staff & payroll',
  data: 'Backups & data',
} as const;
export type Category = keyof typeof CATEGORIES;

export interface Entry {
  category: Category;
  /** machine-readable, e.g. "payment.delete" */
  action: string;
  /** plain English, e.g. "Deleted payment R-2026-0012 ($200) for Leo R. (1B)" */
  summary: string;
  learnerId?: number | null;
  details?: unknown;
}

export function initActivity(store: Store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY, at TEXT NOT NULL, userId INTEGER, userName TEXT NOT NULL, role TEXT, ip TEXT,
      category TEXT NOT NULL, action TEXT NOT NULL, summary TEXT NOT NULL, learnerId INTEGER, details TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_activity_at ON activity(at);
    CREATE INDEX IF NOT EXISTS ix_activity_user ON activity(userId);
    CREATE INDEX IF NOT EXISTS ix_activity_learner ON activity(learnerId);
    CREATE INDEX IF NOT EXISTS ix_activity_cat ON activity(category);`);
}

/** Append an entry. `who` overrides the logged-in user (logins, where there is no session yet). */
export function logActivity(store: Store, req: Request, e: Entry, who?: { id: number | null; name: string; role?: string | null }) {
  const u = who ?? (req.user ? { id: req.user.id, name: req.user.name, role: req.user.role } : { id: null, name: 'Unknown', role: null });
  store.db.prepare(`INSERT INTO activity (at, userId, userName, role, ip, category, action, summary, learnerId, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    new Date().toISOString(), u.id, u.name, u.role ?? null, req.ip ?? null, e.category, e.action, e.summary,
    e.learnerId ?? null, e.details === undefined ? null : JSON.stringify(e.details),
  );
}

/** Fields that differ between two records: { field: [before, after] }. */
export function diff(before: Record<string, any>, after: Record<string, any>, keys: readonly string[]) {
  const out: Record<string, [unknown, unknown]> = {};
  const norm = (v: any) => (v === undefined || v === '' ? null : v);
  for (const k of keys) if (JSON.stringify(norm(before[k])) !== JSON.stringify(norm(after[k]))) out[k] = [norm(before[k]), norm(after[k])];
  return out;
}

/** "guardian phone, class (5A → 6A)": field names, with short values shown inline. */
export function describeDiff(d: Record<string, [unknown, unknown]>, labels: Record<string, string> = {}) {
  return Object.entries(d).map(([k, [a, b]]) => {
    const name = labels[k] ?? k.replace(/([A-Z])/g, ' $1').toLowerCase();
    const short = (v: unknown) => (v === null ? '–' : String(v));
    return typeof a !== 'object' && typeof b !== 'object' && short(a).length + short(b).length <= 40 ? `${name} (${short(a)} → ${short(b)})` : name;
  }).join(', ');
}

export interface Query { category?: string; userId?: string; learnerId?: string; q?: string; from?: string; to?: string; before?: string; limit?: string }

/** Newest first. `from` / `to` are yyyy-mm-dd (inclusive), in the server's time zone. */
export function queryActivity(store: Store, q: Query, cap = 100) {
  const where: string[] = [], args: any[] = [];
  if (q.category && q.category in CATEGORIES) { where.push('category = ?'); args.push(q.category); }
  if (q.userId) { where.push(q.userId === 'none' ? 'userId IS NULL' : 'userId = ?'); if (q.userId !== 'none') args.push(+q.userId); }
  if (q.learnerId) { where.push('learnerId = ?'); args.push(+q.learnerId); }
  if (q.q) { where.push("(summary LIKE ? ESCAPE '\\' OR userName LIKE ? ESCAPE '\\')"); const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`; args.push(like, like); }
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) { where.push('at >= ?'); args.push(new Date(`${q.from}T00:00:00`).toISOString()); }
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) { where.push('at < ?'); const d = new Date(`${q.to}T00:00:00`); d.setDate(d.getDate() + 1); args.push(d.toISOString()); }
  if (q.before) { where.push('id < ?'); args.push(+q.before); }
  const limit = Math.max(1, Math.min(cap, Number(q.limit) || cap));
  const rows = store.db.prepare(`SELECT * FROM activity ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1) as any[];
  return {
    items: rows.slice(0, limit).map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
    hasMore: rows.length > limit,
  };
}

export function activityUsers(store: Store) {
  return store.db.prepare(`SELECT userId, userName, MAX(id) AS last FROM activity GROUP BY userId ORDER BY userName`).all() as { userId: number | null; userName: string }[];
}

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // never let a spreadsheet run a cell as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function activityCsv(store: Store, q: Query) {
  const { items } = queryActivity(store, { ...q, before: undefined }, 100_000);
  const head = ['When (UTC)', 'Who', 'Role', 'Area', 'Action', 'Summary', 'Learner ID', 'Address', 'Details'];
  const lines = items.map((r) => [r.at, r.userName, r.role, CATEGORIES[r.category as Category] ?? r.category, r.action, r.summary, r.learnerId, r.ip, r.details].map(csvCell).join(','));
  return '﻿' + [head.join(','), ...lines].join('\r\n');
}
