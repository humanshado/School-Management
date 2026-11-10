/**
 * LIBRARY and TRANSPORT.
 *
 * Library: books (with a number of copies), loans to learners or teachers, renewals, returns, overdue list.
 *   A loan lasts Settings.loanDays (14); a late return shows a fine of Settings.finePerDay per day (0 = no fines; the fine
 *   is shown, not billed). A borrower can have at most 5 books out; a book cannot be lent when every copy is out.
 * Transport: routes (vehicle, driver, capacity), stops (morning / afternoon times), riders (one route per learner) and
 *   daily trip logs. GPS tracking needs hardware on the buses and is not part of the app.
 */
import { Router, type Request } from 'express';
import { logActivity } from './activity.ts';
import type { Row, Store } from './db.ts';
import { appToday, dayNum, fullName, hasItem, isoOf } from './engine.ts';
import { bad, h, isIso, isTime, need, notFound, pick, str } from './kit.ts';

const MAX_LOANS = 5;

export function loanInfo(store: Store, l: Row, today: string): Row & { daysLate: number; fine: number; overdue: boolean } {
  const s = store.settings();
  const late = !l.returnedOn && l.dueOn < today ? dayNum(today) - dayNum(l.dueOn) : l.returnedOn && l.returnedOn > l.dueOn ? dayNum(l.returnedOn) - dayNum(l.dueOn) : 0;
  return { ...l, daysLate: late, fine: late * (s.finePerDay ?? 0), overdue: !l.returnedOn && late > 0 };
}

export function buildResourcesApi(store: Store) {
  const r = Router();
  const S = () => store.settings();
  const today = () => appToday(S());
  const log = (req: Request, category: 'library' | 'transport', action: string, summary: string, extra: { learnerId?: number | null; details?: unknown } = {}) =>
    logActivity(store, req, { category, action, summary, ...extra });

  // ============================================================ library
  const available = (bookId: number) => {
    const b = store.get('books', bookId);
    const out = (store.db.prepare('SELECT COUNT(*) AS n FROM loans WHERE bookId = ? AND returnedOn IS NULL').get(bookId) as { n: number }).n;
    return (b?.copies ?? 0) - out;
  };
  const BOOK_COLS = ['title', 'author', 'isbn', 'category', 'copies', 'shelf', 'notes'];
  const checkBook = (b: Record<string, any>) => {
    if (!str(b.title)) throw bad('Give the book a title');
    if (!(Number(b.copies) >= 1) || !Number.isInteger(Number(b.copies))) throw bad('Copies must be a whole number, 1 or more');
  };

  r.get('/books', h((req) => {
    need(req, 'staff');
    const q = str(req.query.q).toLowerCase();
    const loans = store.db.prepare('SELECT bookId, COUNT(*) AS n FROM loans WHERE returnedOn IS NULL GROUP BY bookId').all() as { bookId: number; n: number }[];
    const out = new Map(loans.map((x) => [x.bookId, x.n]));
    return {
      items: store.all('books', 'ORDER BY title').filter((b) => !q || [b.title, b.author, b.isbn, b.category, b.shelf].some((v) => v?.toLowerCase().includes(q)))
        .map((b) => ({ ...b, out: out.get(b.id) ?? 0, available: b.copies - (out.get(b.id) ?? 0) })),
      canEdit: !!req.perms?.library, loanDays: S().loanDays ?? 14, finePerDay: S().finePerDay ?? 0,
    };
  }));
  r.post('/books', h((req) => {
    need(req, 'library');
    const b = { copies: 1, ...pick(req.body, BOOK_COLS) };
    checkBook(b);
    const row = store.insert('books', b);
    log(req, 'library', 'book.create', `Added book "${row.title}"${row.author ? ` by ${row.author}` : ''} (${row.copies} cop${row.copies === 1 ? 'y' : 'ies'})`);
    return row;
  }));
  r.put('/books/:id', h((req) => {
    need(req, 'library');
    const cur = store.get('books', +req.params.id) ?? (() => { throw notFound('Book'); })();
    const b = { ...cur, ...pick(req.body, BOOK_COLS) };
    checkBook(b);
    const out = cur.copies - available(cur.id);
    if (Number(b.copies) < out) throw bad(`${out} copies are out on loan: you cannot have fewer copies than that`);
    const row = store.update('books', cur.id, b)!;
    log(req, 'library', 'book.update', `Edited book "${row.title}"`);
    return row;
  }));
  r.delete('/books/:id', h((req) => {
    need(req, 'library');
    const cur = store.get('books', +req.params.id) ?? (() => { throw notFound('Book'); })();
    if (available(cur.id) < cur.copies) throw bad('Some copies are still out on loan');
    store.db.prepare('DELETE FROM loans WHERE bookId = ?').run(cur.id);
    store.remove('books', cur.id);
    log(req, 'library', 'book.delete', `Removed book "${cur.title}" from the catalogue`, { details: cur });
  }));
  r.put('/library/settings', h((req) => {
    need(req, 'library');
    const loanDays = Number(req.body?.loanDays), finePerDay = Number(req.body?.finePerDay);
    if (!(loanDays >= 1 && loanDays <= 365)) throw bad('Loan length must be 1 to 365 days');
    if (!(finePerDay >= 0)) throw bad('The fine must be 0 or more');
    store.saveSettings({ ...S(), loanDays, finePerDay });
    log(req, 'library', 'library.settings', `Library: loans last ${loanDays} days, fine ${finePerDay} per day late`);
    return { loanDays, finePerDay };
  }));

  r.get('/loans', h((req) => {
    need(req, 'staff');
    const t = today();
    const status = str(req.query.status) || 'open';
    const where = status === 'returned' ? 'WHERE returnedOn IS NOT NULL' : status === 'all' ? '' : 'WHERE returnedOn IS NULL';
    const books = new Map(store.all('books').map((b) => [b.id, b]));
    let rows = store.all('loans', `${where} ORDER BY ${status === 'returned' ? 'returnedOn DESC' : 'dueOn'}, id DESC LIMIT 500`).map((l) => loanInfo(store, l, t));
    if (status === 'overdue') rows = rows.filter((l) => l.overdue);
    if (req.query.borrowerType && req.query.borrowerId) rows = rows.filter((l) => l.borrowerType === req.query.borrowerType && l.borrowerId === +req.query.borrowerId!);
    return rows.map((l) => {
      const st = l.borrowerType === 'learner' ? store.get('students', l.borrowerId) : null;
      return { ...l, book: books.get(l.bookId)?.title ?? '(removed)', author: books.get(l.bookId)?.author ?? '', className: st?.className ?? null, guardianName: st?.guardianName ?? null, guardianEmail: st?.guardianEmail ?? null };
    });
  }));
  r.post('/loans', h((req) => {
    need(req, 'library');
    const book = store.get('books', Number(req.body?.bookId)) ?? (() => { throw notFound('Book'); })();
    const type = str(req.body?.borrowerType), id = Number(req.body?.borrowerId);
    let name = '';
    if (type === 'learner') {
      const st = store.get('students', id);
      if (!st || (st.status && st.status !== 'Active')) throw bad('Pick an active learner');
      name = `${fullName(st)} (${st.className})`;
    } else if (type === 'staff') {
      const t = store.get('teachers', id);
      if (!t) throw bad('Pick a member of staff');
      name = t.name;
    } else throw bad('Lend to a learner or a member of staff');
    if (available(book.id) < 1) throw bad(`Every copy of "${book.title}" is out on loan`);
    const open = (store.db.prepare('SELECT COUNT(*) AS n FROM loans WHERE borrowerType = ? AND borrowerId = ? AND returnedOn IS NULL').get(type, id) as { n: number }).n;
    if (open >= MAX_LOANS) throw bad(`${name} already has ${open} books out (the most is ${MAX_LOANS})`);
    const t = today();
    const dueOn = req.body?.dueOn && isIso(req.body.dueOn) ? req.body.dueOn : isoOf(dayNum(t) + (S().loanDays ?? 14));
    if (dueOn < t) throw bad('The due date is in the past');
    const row = store.insert('loans', { bookId: book.id, borrowerType: type, borrowerId: id, borrowerName: name, borrowedOn: t, dueOn, issuedBy: req.user!.name });
    log(req, 'library', 'loan.create', `Lent "${book.title}" to ${name}, due ${dueOn}`, { learnerId: type === 'learner' ? id : null });
    return row;
  }));
  const loanOr404 = (id: number) => store.get('loans', id) ?? (() => { throw notFound('Loan'); })();
  r.post('/loans/:id/return', h((req) => {
    need(req, 'library');
    const l = loanOr404(+req.params.id);
    if (l.returnedOn) throw bad('Already returned');
    const on = req.body?.returnedOn && isIso(req.body.returnedOn) ? req.body.returnedOn : today();
    if (on < l.borrowedOn) throw bad('Returned before it was borrowed?');
    const row = loanInfo(store, store.update('loans', l.id, { returnedOn: on })!, today());
    const book = store.get('books', l.bookId);
    log(req, 'library', 'loan.return', `"${book?.title}" returned by ${l.borrowerName}${row.daysLate ? `, ${row.daysLate} days late${row.fine ? ` (fine ${row.fine})` : ''}` : ''}`, { learnerId: l.borrowerType === 'learner' ? l.borrowerId : null });
    return row;
  }));
  r.post('/loans/:id/renew', h((req) => {
    need(req, 'library');
    const l = loanOr404(+req.params.id);
    if (l.returnedOn) throw bad('Already returned');
    const dueOn = isoOf(Math.max(dayNum(l.dueOn), dayNum(today())) + (S().loanDays ?? 14));
    const row = store.update('loans', l.id, { dueOn })!;
    log(req, 'library', 'loan.renew', `Renewed "${store.get('books', l.bookId)?.title}" for ${l.borrowerName} until ${dueOn}`, { learnerId: l.borrowerType === 'learner' ? l.borrowerId : null });
    return row;
  }));

  // ============================================================ transport
  const ROUTE_COLS = ['name', 'vehicle', 'driver', 'driverPhone', 'capacity', 'notes'];
  const routeOr404 = (id: number) => store.get('routes', id) ?? (() => { throw notFound('Route'); })();
  const transportFee = () => S().optionalFees.find((f) => /transport|bus/i.test(f.name))?.name ?? null;

  r.get('/routes', h((req) => {
    need(req, 'staff');
    const fee = transportFee();
    const stops = store.all('stops', 'ORDER BY routeId, seq, amTime');
    const riders = store.all('riders');
    return {
      canEdit: !!req.perms?.transport, transportFee: fee,
      items: store.all('routes', 'ORDER BY name').map((rt) => ({
        ...rt,
        stops: stops.filter((s) => s.routeId === rt.id),
        riders: riders.filter((x) => x.routeId === rt.id).map((x) => {
          const st = store.get('students', x.learnerId);
          return { ...x, name: st ? fullName(st) : `#${x.learnerId}`, className: st?.className, guardianName: st?.guardianName, guardianPhone: st?.guardianPhone, billed: !fee || hasItem(st?.optionalFees, fee) };
        }).sort((a, b) => a.name.localeCompare(b.name)),
      })),
    };
  }));
  const checkRoute = (b: Record<string, any>) => {
    if (!str(b.name)) throw bad('Name the route');
    if (b.capacity !== null && b.capacity !== undefined && b.capacity !== '' && !(Number(b.capacity) >= 1)) throw bad('Capacity must be 1 or more');
  };
  r.post('/routes', h((req) => {
    need(req, 'transport');
    const b = pick(req.body, ROUTE_COLS); checkRoute(b);
    const row = store.insert('routes', b);
    log(req, 'transport', 'route.create', `Added route ${row.name}${row.vehicle ? ` (${row.vehicle})` : ''}`);
    return row;
  }));
  r.put('/routes/:id', h((req) => {
    need(req, 'transport');
    const cur = routeOr404(+req.params.id);
    const b = { ...cur, ...pick(req.body, ROUTE_COLS) }; checkRoute(b);
    const n = store.all('riders', 'WHERE routeId = ?', cur.id).length;
    if (b.capacity && n > Number(b.capacity)) throw bad(`${n} learners ride this route: the capacity cannot be less than that`);
    const row = store.update('routes', cur.id, b)!;
    log(req, 'transport', 'route.update', `Edited route ${row.name}`);
    return row;
  }));
  r.delete('/routes/:id', h((req) => {
    need(req, 'transport');
    const cur = routeOr404(+req.params.id);
    if (store.all('riders', 'WHERE routeId = ?', cur.id).length) throw bad('Learners still ride this route: move them first');
    store.tx(() => { for (const t of ['stops', 'trips']) store.db.prepare(`DELETE FROM ${t} WHERE routeId = ?`).run(cur.id); store.db.prepare('DELETE FROM routes WHERE id = ?').run(cur.id); });
    log(req, 'transport', 'route.delete', `Deleted route ${cur.name}`, { details: cur });
  }));

  r.put('/routes/:id/stops', h((req) => {
    need(req, 'transport');
    const rt = routeOr404(+req.params.id);
    const list = req.body?.stops;
    if (!Array.isArray(list)) throw bad('No stops sent');
    for (const s of list) {
      if (!str(s.name)) throw bad('Every stop needs a name');
      if (s.amTime && !isTime(s.amTime)) throw bad(`${s.name}: morning time is not valid`);
      if (s.pmTime && !isTime(s.pmTime)) throw bad(`${s.name}: afternoon time is not valid`);
    }
    const keep = new Set(list.filter((s: any) => s.id).map((s: any) => Number(s.id)));
    const gone = store.all('stops', 'WHERE routeId = ?', rt.id).filter((s) => !keep.has(s.id));
    for (const g of gone) if (store.all('riders', 'WHERE stopId = ?', g.id).length) throw bad(`Learners are picked up at ${g.name}: move them before removing it`);
    store.tx(() => {
      for (const g of gone) store.db.prepare('DELETE FROM stops WHERE id = ?').run(g.id);
      list.forEach((s: any, i: number) => {
        const v = [str(s.name), str(s.amTime) || null, str(s.pmTime) || null, i + 1];
        if (s.id) store.db.prepare('UPDATE stops SET name = ?, amTime = ?, pmTime = ?, seq = ? WHERE id = ? AND routeId = ?').run(...v, Number(s.id), rt.id);
        else store.db.prepare('INSERT INTO stops (name, amTime, pmTime, seq, routeId) VALUES (?, ?, ?, ?, ?)').run(...v, rt.id);
      });
    });
    log(req, 'transport', 'route.stops', `Updated the stops of route ${rt.name} (${list.length} stops)`);
    return store.all('stops', 'WHERE routeId = ? ORDER BY seq', rt.id);
  }));

  /** Put a learner on a route (one route per learner); no routeId removes them from transport. */
  r.put('/riders/:learnerId', h((req) => {
    need(req, 'transport');
    const lid = +req.params.learnerId;
    const st = store.get('students', lid) ?? (() => { throw notFound('Learner'); })();
    const cur = store.all('riders', 'WHERE learnerId = ?', lid)[0];
    const routeId = Number(req.body?.routeId) || null;
    if (!routeId) {
      if (cur) { store.remove('riders', cur.id); log(req, 'transport', 'rider.remove', `${fullName(st)} no longer uses school transport`, { learnerId: lid }); }
      return null;
    }
    const rt = routeOr404(routeId);
    const stop = store.get('stops', Number(req.body?.stopId));
    if (!stop || stop.routeId !== rt.id) throw bad('Pick a stop on that route');
    const n = store.all('riders', 'WHERE routeId = ? AND learnerId != ?', rt.id, lid).length;
    if (rt.capacity && n >= rt.capacity) throw bad(`Route ${rt.name} is full (${rt.capacity} seats)`);
    const row = { learnerId: lid, routeId: rt.id, stopId: stop.id, notes: str(req.body?.notes) || null };
    const saved = cur ? store.update('riders', cur.id, row) : store.insert('riders', row);
    log(req, 'transport', 'rider.set', `${fullName(st)} (${st.className}) rides route ${rt.name}, stop ${stop.name}`, { learnerId: lid });
    return saved;
  }));

  r.get('/trips', h((req) => {
    need(req, 'staff');
    const where: string[] = [], args: any[] = [];
    if (req.query.routeId) { where.push('routeId = ?'); args.push(+req.query.routeId); }
    if (req.query.date) { where.push('date = ?'); args.push(str(req.query.date)); }
    return store.all('trips', `${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date DESC, direction LIMIT 200`, ...args);
  }));
  r.post('/trips', h((req) => {
    need(req, 'transport');
    const b = pick(req.body, ['routeId', 'date', 'direction', 'departedAt', 'arrivedAt', 'driver', 'absent', 'notes']);
    const rt = routeOr404(Number(b.routeId));
    b.date = b.date || today();
    if (!isIso(b.date)) throw bad('Pick the date');
    if (!['AM', 'PM'].includes(b.direction)) throw bad('Morning or afternoon?');
    for (const k of ['departedAt', 'arrivedAt']) if (b[k] && !isTime(b[k])) throw bad('Times are hh:mm');
    if (store.all('trips', 'WHERE routeId = ? AND date = ? AND direction = ?', rt.id, b.date, b.direction).length) throw bad(`The ${b.direction === 'AM' ? 'morning' : 'afternoon'} trip of ${rt.name} on ${b.date} is already logged`);
    const row = store.insert('trips', { ...b, routeId: rt.id, driver: str(b.driver) || rt.driver, loggedBy: req.user!.name });
    log(req, 'transport', 'trip.log', `Logged the ${b.direction === 'AM' ? 'morning' : 'afternoon'} trip of ${rt.name} on ${b.date}${b.departedAt ? ` (${b.departedAt}–${b.arrivedAt ?? '?'})` : ''}`);
    return row;
  }));
  r.delete('/trips/:id', h((req) => {
    need(req, 'transport');
    const t = store.get('trips', +req.params.id) ?? (() => { throw notFound('Trip'); })();
    store.remove('trips', t.id);
    log(req, 'transport', 'trip.delete', `Deleted a trip log (${t.date} ${t.direction})`, { details: t });
  }));
  return r;
}
