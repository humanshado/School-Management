import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Settings } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(here, '../data');
export const SAMPLE_FILE = resolve(DATA_DIR, 'sample.json');

/** Columns of every table (id is always the INTEGER PRIMARY KEY). Also the whitelist for the REST API. */
export const TABLES = {
  students: ['learnerNo', 'firstName', 'lastName', 'className', 'dob', 'gender', 'status', 'enrolmentDate',
    'optionalFees', 'guardianName', 'relationship', 'guardianPhone', 'guardianEmail', 'address', 'medicalNote', 'notes'],
  classes: ['name', 'grade', 'stream', 'teacher', 'room', 'notes'],
  teachers: ['name', 'phone', 'email', 'subjects', 'notes'],
  registers: ['date', 'className', 'takenBy', 'present', 'enrolled'],
  attendance: ['learnerId', 'date', 'className', 'mark', 'note'],
  assessments: ['term', 'className', 'subject', 'name', 'weight', 'outOf', 'date'],
  marks: ['assessmentId', 'learnerId', 'mark'],
  comments: ['learnerId', 'term', 'teacherComment', 'principalComment'],
  payments: ['studentId', 'receiptNo', 'date', 'term', 'amount', 'method', 'reference', 'paidBy', 'note'],
  paymentPlans: ['studentId', 'term', 'agreedOn', 'instalment', 'nextDue', 'note'],
  // ---- documents (files on disk, see files.ts)
  documents: ['ownerType', 'ownerId', 'label', 'filename', 'mime', 'size', 'storedAs', 'uploadedBy', 'at'],
  // ---- learning: homework, study materials, notices
  homework: ['className', 'subject', 'title', 'details', 'setOn', 'dueOn', 'postedBy', 'at'],
  materials: ['className', 'subject', 'title', 'details', 'link', 'postedBy', 'at'],
  announcements: ['title', 'body', 'audience', 'pinned', 'expires', 'postedBy', 'postedById', 'at'],
  // ---- timetable, cover, exams
  timetable: ['className', 'day', 'period', 'subject', 'teacher', 'room'],
  covers: ['date', 'timetableId', 'absentTeacher', 'substitute', 'notes', 'arrangedBy'],
  exams: ['term', 'className', 'subject', 'title', 'date', 'start', 'end', 'room', 'invigilator', 'notes'],
  // ---- admissions
  applications: ['ref', 'status', 'firstName', 'lastName', 'dob', 'gender', 'gradeApplying', 'guardianName', 'relationship',
    'guardianPhone', 'guardianEmail', 'address', 'previousSchool', 'notes', 'submittedAt', 'updatedAt', 'interviewAt',
    'decisionNotes', 'studentId', 'token'],
  // ---- library
  books: ['title', 'author', 'isbn', 'category', 'copies', 'shelf', 'notes'],
  loans: ['bookId', 'borrowerType', 'borrowerId', 'borrowerName', 'borrowedOn', 'dueOn', 'returnedOn', 'issuedBy', 'notes'],
  // ---- transport
  routes: ['name', 'vehicle', 'driver', 'driverPhone', 'capacity', 'notes'],
  stops: ['routeId', 'name', 'amTime', 'pmTime', 'seq'],
  riders: ['learnerId', 'routeId', 'stopId', 'notes'],
  trips: ['routeId', 'date', 'direction', 'departedAt', 'arrivedAt', 'driver', 'absent', 'notes', 'loggedBy'],
  // ---- HR & payroll
  staff: ['name', 'position', 'department', 'phone', 'email', 'hireDate', 'status', 'teacherName', 'bankName', 'bankAccount',
    'baseSalary', 'payItems', 'notes'],
  staffAttendance: ['staffId', 'date', 'mark', 'note'],
  leave: ['staffId', 'type', 'fromDate', 'toDate', 'days', 'status', 'reason', 'decidedBy'],
  payruns: ['month', 'status', 'notes', 'createdBy', 'createdAt', 'approvedBy', 'approvedAt', 'paidAt'],
  payslips: ['payrunId', 'staffId', 'staffName', 'position', 'base', 'lines', 'gross', 'deductions', 'net'],
} as const;
export type TableName = keyof typeof TABLES;

const NUMERIC_COLS = new Set(['present', 'enrolled', 'learnerId', 'weight', 'outOf', 'assessmentId', 'studentId', 'amount', 'instalment']);
/** Number columns of the newer tables, per table (a column name can mean a number in one table and text in another). */
const NUMERIC_BY_TABLE: Record<string, string[]> = {
  marks: ['mark'], // attendance.mark is a letter (P / A / L / E); marks.mark is a number
  documents: ['ownerId', 'size'], announcements: ['pinned', 'postedById'], timetable: ['day', 'period'], covers: ['timetableId'],
  applications: ['studentId'], books: ['copies'], loans: ['bookId', 'borrowerId'], routes: ['capacity'], stops: ['routeId', 'seq'],
  riders: ['routeId', 'stopId'], trips: ['routeId'], staff: ['baseSalary'], staffAttendance: ['staffId'], leave: ['staffId', 'days'],
  payslips: ['payrunId', 'staffId', 'base', 'gross', 'deductions', 'net'],
};
const isNumeric = (t: string, c: string) => c === 'id' || NUMERIC_COLS.has(c) || !!NUMERIC_BY_TABLE[t]?.includes(c);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
${Object.entries(TABLES).map(([t, cols]) =>
  `CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY, ${cols.map((c) => `${c} ${isNumeric(t, c) ? 'REAL' : 'TEXT'}`).join(', ')});`).join('\n')}
CREATE INDEX IF NOT EXISTS ix_att_date ON attendance(date, className);
CREATE INDEX IF NOT EXISTS ix_att_learner ON attendance(learnerId);
CREATE INDEX IF NOT EXISTS ix_reg ON registers(className, date);
CREATE INDEX IF NOT EXISTS ix_marks ON marks(assessmentId, learnerId);
CREATE INDEX IF NOT EXISTS ix_ass ON assessments(term, className, subject);
CREATE INDEX IF NOT EXISTS ix_pay ON payments(studentId, term);
CREATE INDEX IF NOT EXISTS ix_docs ON documents(ownerType, ownerId);
CREATE INDEX IF NOT EXISTS ix_hw ON homework(className, dueOn);
CREATE INDEX IF NOT EXISTS ix_tt ON timetable(className, day, period);
CREATE INDEX IF NOT EXISTS ix_loans ON loans(bookId, returnedOn);
CREATE INDEX IF NOT EXISTS ix_satt ON staffAttendance(staffId, date);
CREATE INDEX IF NOT EXISTS ix_slips ON payslips(payrunId);
`;

export type Row = Record<string, any> & { id: number };

export class Store {
  db: DatabaseSync;
  /** Bumped on every write: the engine's cache key. */
  version = 0;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  get isEmpty() {
    return !this.db.prepare('SELECT 1 FROM settings').get();
  }

  settings(): Settings {
    const r = this.db.prepare('SELECT json FROM settings WHERE id = 1').get() as { json: string } | undefined;
    return r ? JSON.parse(r.json) : ({} as Settings);
  }

  saveSettings(s: Settings) {
    this.db.prepare('INSERT INTO settings (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json').run(JSON.stringify(s));
    this.version++;
  }

  all(t: TableName, where = '', ...params: any[]): Row[] {
    return this.db.prepare(`SELECT * FROM ${t} ${where}`).all(...params) as Row[];
  }

  get(t: TableName, id: number): Row | undefined {
    return this.db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id) as Row | undefined;
  }

  /** Only whitelisted columns are written; missing ones become NULL on insert. */
  insert(t: TableName, data: Record<string, any>): Row {
    const cols = TABLES[t] as readonly string[];
    const keys = data.id != null ? ['id', ...cols] : [...cols];
    const vals = keys.map((k) => clean(t, k, data[k]));
    const r = this.db.prepare(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...vals);
    this.version++;
    return this.get(t, Number(data.id ?? r.lastInsertRowid))!;
  }

  update(t: TableName, id: number, data: Record<string, any>): Row | undefined {
    const cols = (TABLES[t] as readonly string[]).filter((c) => c in data);
    if (cols.length) {
      this.db.prepare(`UPDATE ${t} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => clean(t, c, data[c])), id);
      this.version++;
    }
    return this.get(t, id);
  }

  remove(t: TableName, id: number) {
    const r = this.db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(id);
    this.version++;
    return r.changes > 0;
  }

  run(sql: string, ...params: any[]) {
    const r = this.db.prepare(sql).run(...params);
    this.version++;
    return r;
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      this.version++;
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Wipe everything and load a seed (the JSON written by scripts/import_xlsm.py). */
  load(seed: any) {
    this.tx(() => {
      this.db.exec(`DELETE FROM settings; ${Object.keys(TABLES).map((t) => `DELETE FROM ${t};`).join(' ')}`);
      this.db.prepare('INSERT INTO settings (id, json) VALUES (1, ?)').run(JSON.stringify(seed.settings ?? {}));
      for (const t of Object.keys(TABLES) as TableName[]) {
        let rows: any[] = seed[t] ?? [];
        if (t === 'marks') rows = rows.map((m) => (Array.isArray(m) ? { id: m[0], assessmentId: m[1], learnerId: m[2], mark: m[3] } : m));
        const cols = ['id', ...TABLES[t]];
        const st = this.db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
        for (const r of rows) st.run(...cols.map((c) => clean(t, c, r[c])));
      }
    });
  }

  /** Clear the school's data but keep settings, lists, calendar and templates (like "Clear Sample Data"). */
  clearData() {
    this.tx(() => {
      for (const t of Object.keys(TABLES)) this.db.exec(`DELETE FROM ${t}`);
      const s = this.settings();
      s.sampleMode = false;
      this.db.prepare('UPDATE settings SET json = ? WHERE id = 1').run(JSON.stringify(s));
    });
  }
}

function clean(t: string, col: string, v: any) {
  if (v === undefined || v === '') return null;
  if (isNumeric(t, col)) {
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v === null ? null : String(v);
}

export function openStore(file = process.env.DB_PATH ?? resolve(DATA_DIR, 'school.db')) {
  const store = new Store(file);
  if (store.isEmpty && existsSync(SAMPLE_FILE)) {
    store.load(JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')));
    console.log(`Loaded sample data from ${SAMPLE_FILE}`);
  }
  return store;
}
