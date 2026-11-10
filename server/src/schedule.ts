/**
 * TIMETABLE, COVER and EXAMS.
 *   timetable  one lesson per class per day (1 Mon .. 5 Fri) and period (Settings > periods). A teacher or a room cannot be
 *              in two lessons at once.
 *   cover      mark a teacher absent on a date: each of their lessons that day needs a substitute; the free teachers in that
 *              period are suggested, and a substitute who is already teaching or covering then is refused.
 *   exams      per term: class, subject, date, start-end, room, invigilator. A class, room or invigilator cannot have two
 *              exams that overlap.
 */
import { Router, type Request } from 'express';
import { logActivity } from './activity.ts';
import type { Row, Store } from './db.ts';
import { dayNum, holidayOn, weekday } from './engine.ts';
import { bad, h, isIso, isTime, need, notFound, pick, str } from './kit.ts';
import type { Settings } from './types.ts';

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const DEFAULT_PERIODS = [
  { name: '1', start: '08:00', end: '08:40' }, { name: '2', start: '08:40', end: '09:20' }, { name: '3', start: '09:20', end: '10:00' },
  { name: '4', start: '10:20', end: '11:00' }, { name: '5', start: '11:00', end: '11:40' }, { name: '6', start: '11:40', end: '12:20' },
  { name: '7', start: '13:00', end: '13:40' }, { name: '8', start: '13:40', end: '14:20' },
];
export const periodsOf = (s: Settings) => (s.periods?.length ? s.periods : DEFAULT_PERIODS);
const overlap = (a1: string, a2: string, b1: string, b2: string) => a1 < b2 && b1 < a2;

export function buildScheduleApi(store: Store) {
  const r = Router();
  const S = () => store.settings();
  const log = (req: Request, action: string, summary: string, details?: unknown) => logActivity(store, req, { category: 'timetable', action, summary, details });
  const teachers = () => (store.db.prepare('SELECT name FROM teachers ORDER BY name').all() as { name: string }[]).map((t) => t.name);
  const classes = () => (store.db.prepare('SELECT name FROM classes ORDER BY name').all() as { name: string }[]).map((c) => c.name);
  const slotName = (day: number, period: number) => `${DAYS[day - 1]} period ${periodsOf(S())[period]?.name ?? period + 1}`;

  // ------------------------------------------------------------ timetable
  r.get('/timetable', h((req) => {
    need(req, 'staff');
    const where: string[] = [], args: any[] = [];
    for (const k of ['class', 'teacher', 'room'] as const) if (req.query[k]) { where.push(`${k === 'class' ? 'className' : k} = ?`); args.push(str(req.query[k])); }
    return {
      days: DAYS, periods: periodsOf(S()), teachers: teachers(), classes: classes(),
      rooms: (store.db.prepare("SELECT DISTINCT room FROM timetable WHERE room IS NOT NULL AND room != '' UNION SELECT DISTINCT room FROM classes WHERE room IS NOT NULL AND room != '' ORDER BY 1").all() as { room: string }[]).map((x) => x.room),
      entries: store.all('timetable', where.length ? `WHERE ${where.join(' AND ')}` : '', ...args),
      canEdit: !!req.perms?.admin,
    };
  }));

  /** Set (or clear, with no subject) one class's lesson in one slot. */
  r.put('/timetable/slot', h((req) => {
    need(req, 'admin');
    const b = pick(req.body, ['className', 'day', 'period', 'subject', 'teacher', 'room']);
    const day = Number(b.day), period = Number(b.period);
    if (!classes().includes(b.className)) throw bad('Unknown class');
    if (!(day >= 1 && day <= 5) || !(period >= 0 && period < periodsOf(S()).length)) throw bad('Unknown day or period');
    const cur = store.all('timetable', 'WHERE className = ? AND day = ? AND period = ?', b.className, day, period)[0];
    if (!str(b.subject)) {
      if (cur) { store.remove('timetable', cur.id); log(req, 'timetable.clear', `Cleared ${b.className}'s lesson on ${slotName(day, period)} (${cur.subject})`, cur); }
      return null;
    }
    const teacher = str(b.teacher) || null, room = str(b.room) || null;
    if (teacher && !teachers().includes(teacher)) throw bad('That teacher is not on the Teachers list');
    if (teacher) {
      const busy = store.all('timetable', 'WHERE teacher = ? AND day = ? AND period = ? AND className != ?', teacher, day, period, b.className)[0];
      if (busy) throw bad(`${teacher} already teaches ${busy.className} (${busy.subject}) on ${slotName(day, period)}`);
    }
    if (room) {
      const busy = store.all('timetable', 'WHERE room = ? AND day = ? AND period = ? AND className != ?', room, day, period, b.className)[0];
      if (busy) throw bad(`${room} is already used by ${busy.className} (${busy.subject}) on ${slotName(day, period)}`);
    }
    const row = { className: b.className, day, period, subject: str(b.subject), teacher, room };
    const saved = cur ? store.update('timetable', cur.id, row)! : store.insert('timetable', row);
    log(req, 'timetable.set', `${b.className}, ${slotName(day, period)}: ${row.subject}${teacher ? ` with ${teacher}` : ''}${room ? ` in ${room}` : ''}${cur ? ` (was ${cur.subject}${cur.teacher ? ` with ${cur.teacher}` : ''})` : ''}`);
    return saved;
  }));

  r.put('/timetable/periods', h((req) => {
    need(req, 'admin');
    const list = req.body?.periods;
    if (!Array.isArray(list) || !list.length || list.length > 14) throw bad('Give between 1 and 14 periods');
    for (const p of list) if (!str(p.name) || !isTime(p.start) || !isTime(p.end) || p.end <= p.start) throw bad(`Period "${p.name || '?'}": check its name and times`);
    const removed = periodsOf(S()).length - list.length;
    if (removed > 0 && store.all('timetable', 'WHERE period >= ?', list.length).length) throw bad('Some lessons are in the periods you removed: clear them first');
    const s = S();
    store.saveSettings({ ...s, periods: list.map((p: any) => ({ name: str(p.name), start: p.start, end: p.end })) });
    log(req, 'timetable.periods', `Changed the school day's periods (${list.length} periods, ${list[0].start}–${list[list.length - 1].end})`);
    return periodsOf(store.settings());
  }));

  // ------------------------------------------------------------ cover
  /** Lessons needing cover on a date, with the teachers free in each period. */
  const coverDay = (date: string) => {
    const day = weekday(dayNum(date));
    const covers = store.all('covers', 'WHERE date = ? ORDER BY id', date);
    const absent = [...new Set(covers.map((c) => c.absentTeacher as string))];
    const lessons = day <= 5 ? store.all('timetable', 'WHERE day = ?', day) : [];
    const busyAt = (period: number) => new Set([
      ...lessons.filter((l) => l.period === period && l.teacher && !absent.includes(l.teacher)).map((l) => l.teacher as string),
      ...covers.filter((c) => c.substitute && lessons.find((l) => l.id === c.timetableId)?.period === period).map((c) => c.substitute as string),
    ]);
    return {
      date, day, holiday: holidayOn(S(), date), absent, periods: periodsOf(S()),
      covers: covers.map((c) => {
        const l = lessons.find((x) => x.id === c.timetableId) ?? store.get('timetable', c.timetableId);
        const busy = l ? busyAt(l.period) : new Set<string>();
        return { ...c, lesson: l ?? null, free: teachers().filter((t) => !absent.includes(t) && (!busy.has(t) || t === c.substitute)) };
      }).sort((a, b) => (a.lesson?.period ?? 0) - (b.lesson?.period ?? 0)),
    };
  };
  /** Every cover reply has the same shape, so the screen can redraw from any of them. */
  const coverOut = (req: Request, date: string) => ({ ...coverDay(date), teachers: teachers(), canEdit: !!req.perms?.admin });
  r.get('/covers', h((req) => {
    need(req, 'staff');
    const date = str(req.query.date);
    if (!isIso(date)) throw bad('Pick a date');
    return coverOut(req, date);
  }));
  r.post('/covers/absent', h((req) => {
    need(req, 'admin');
    const date = str(req.body?.date), teacher = str(req.body?.teacher);
    if (!isIso(date)) throw bad('Pick a date');
    if (!teachers().includes(teacher)) throw bad('Pick a teacher');
    const day = weekday(dayNum(date));
    if (day > 5) throw bad('That date is a weekend');
    if (store.all('covers', 'WHERE date = ? AND absentTeacher = ?', date, teacher).length) throw bad(`${teacher} is already marked absent that day`);
    const lessons = store.all('timetable', 'WHERE day = ? AND teacher = ? ORDER BY period', day, teacher);
    if (!lessons.length) throw bad(`${teacher} has no lessons on ${DAYS[day - 1]}s`);
    store.tx(() => { for (const l of lessons) store.db.prepare('INSERT INTO covers (date, timetableId, absentTeacher, arrangedBy) VALUES (?, ?, ?, ?)').run(date, l.id, teacher, req.user!.name); });
    // a substitute who is now absent loses their cover lessons
    store.db.prepare('UPDATE covers SET substitute = NULL WHERE date = ? AND substitute = ?').run(date, teacher);
    log(req, 'cover.absent', `Marked ${teacher} absent on ${date}: ${lessons.length} lesson${lessons.length === 1 ? '' : 's'} need cover`);
    return coverOut(req, date);
  }));
  r.delete('/covers/absent', h((req) => {
    need(req, 'admin');
    const date = str(req.query.date), teacher = str(req.query.teacher);
    const n = store.db.prepare('DELETE FROM covers WHERE date = ? AND absentTeacher = ?').run(date, teacher).changes;
    if (!n) throw notFound('Absence');
    store.version++;
    log(req, 'cover.cancel', `${teacher} is no longer absent on ${date} (${n} cover lesson${n === 1 ? '' : 's'} removed)`);
    return coverOut(req, date);
  }));
  r.put('/covers/:id', h((req) => {
    need(req, 'admin');
    const c = store.get('covers', +req.params.id) ?? (() => { throw notFound('Cover'); })();
    const sub = str(req.body?.substitute) || null;
    if (sub) {
      const day = coverDay(c.date);
      const me = day.covers.find((x) => x.id === c.id)!;
      if (!me.free.includes(sub)) throw bad(`${sub} is not free then (teaching, covering, or absent)`);
    }
    store.update('covers', c.id, { substitute: sub, notes: req.body?.notes ?? c.notes });
    const l = store.get('timetable', c.timetableId);
    log(req, 'cover.assign', sub ? `${sub} covers ${l?.className} ${l?.subject} (${c.date}, ${l ? slotName(l.day, l.period) : ''}) for ${c.absentTeacher}` : `Removed the substitute for ${l?.className} ${l?.subject} on ${c.date}`);
    return coverOut(req, c.date);
  }));

  // ------------------------------------------------------------ exams
  const EXAM_COLS = ['term', 'className', 'subject', 'title', 'date', 'start', 'end', 'room', 'invigilator', 'notes'];
  const checkExam = (b: Record<string, any>, id = -1) => {
    const s = S();
    if (!s.terms.some((t) => t.name === b.term)) throw bad('Pick a term');
    if (!classes().includes(b.className)) throw bad('Pick a class');
    if (!s.subjects.includes(b.subject)) throw bad('Pick a subject');
    if (!isIso(b.date)) throw bad('Pick the exam date');
    if (!isTime(b.start) || !isTime(b.end) || b.end <= b.start) throw bad('Check the start and end times');
    if (b.invigilator && !teachers().includes(b.invigilator)) throw bad('The invigilator is not on the Teachers list');
    const same = store.all('exams', 'WHERE date = ? AND id != ?', b.date, id).filter((x) => overlap(b.start, b.end, x.start, x.end));
    const c = same.find((x) => x.className === b.className);
    if (c) throw bad(`${b.className} already has ${c.subject} (${c.start}–${c.end}) then`);
    const room = b.room && same.find((x) => x.room === b.room);
    if (room) throw bad(`${b.room} is already used for ${room.className} ${room.subject} (${room.start}–${room.end})`);
    const inv = b.invigilator && same.find((x) => x.invigilator === b.invigilator);
    if (inv) throw bad(`${b.invigilator} is already invigilating ${inv.className} ${inv.subject} (${inv.start}–${inv.end})`);
    if (holidayOn(s, b.date)) throw bad(`${b.date} is a holiday: ${holidayOn(s, b.date)}`);
    if (weekday(dayNum(b.date)) > 5) throw bad('That date is a weekend');
  };
  r.get('/exams', h((req) => {
    need(req, 'staff');
    const where: string[] = [], args: any[] = [];
    if (req.query.term) { where.push('term = ?'); args.push(str(req.query.term)); }
    if (req.query.class) { where.push('className = ?'); args.push(str(req.query.class)); }
    return { items: store.all('exams', `${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date, start, className`, ...args), canEdit: !!req.perms?.admin, teachers: teachers() };
  }));
  r.post('/exams', h((req) => {
    need(req, 'admin');
    const b: Record<string, any> = { term: S().currentTerm, ...pick(req.body, EXAM_COLS) };
    checkExam(b);
    const row = store.insert('exams', b);
    log(req, 'exam.create', `Scheduled ${row.className} ${row.subject} ${row.title || 'exam'} on ${row.date} ${row.start}–${row.end}${row.room ? ` in ${row.room}` : ''}`);
    return row;
  }));
  r.put('/exams/:id', h((req) => {
    need(req, 'admin');
    const cur = store.get('exams', +req.params.id) ?? (() => { throw notFound('Exam'); })();
    const b = { ...cur, ...pick(req.body, EXAM_COLS) };
    checkExam(b, cur.id);
    const row = store.update('exams', cur.id, b)!;
    log(req, 'exam.update', `Changed ${row.className} ${row.subject} exam: ${row.date} ${row.start}–${row.end}${row.room ? ` in ${row.room}` : ''}`, { before: cur, after: row });
    return row;
  }));
  r.delete('/exams/:id', h((req) => {
    need(req, 'admin');
    const cur = store.get('exams', +req.params.id) ?? (() => { throw notFound('Exam'); })();
    store.remove('exams', cur.id);
    log(req, 'exam.delete', `Cancelled ${cur.className} ${cur.subject} exam on ${cur.date}`, cur);
  }));
  return r;
}
