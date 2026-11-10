import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store, SAMPLE_FILE } from '../src/db.ts';
import { createApp } from '../src/app.ts';
import request, { client } from './request.ts';

async function school() {
  const store = new Store(':memory:');
  store.load(JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')));
  const app = createApp(store);
  const admin = (m: string, p: string, b?: unknown) => request(app, m, p, b);
  await admin('GET', '/api/meta');
  return { store, app, admin };
}

test('library: copies limit loans; returns are late with a fine; renewals; librarian role', async () => {
  const { store, app, admin } = await school();
  await admin('PUT', '/api/library/settings', { loanDays: 14, finePerDay: 2 });
  const book = (await admin('POST', '/api/books', { title: 'Charlotte\'s Web', author: 'E. B. White', copies: 1 })).body;
  const lend = (id: number, extra = {}) => admin('POST', '/api/loans', { bookId: book.id, borrowerType: 'learner', borrowerId: id, ...extra });
  const l = await lend(1);
  assert.equal(l.status, 200);
  assert.equal(l.body.dueOn, '2026-11-18', '14 days after the sample date');
  assert.match((await lend(2)).body.error, /Every copy/);
  assert.match((await admin('PUT', `/api/books/${book.id}`, { copies: 0 })).body.error, /whole number, 1 or more/);
  // make it overdue: borrowed long ago
  store.db.prepare("UPDATE loans SET borrowedOn = '2026-10-01', dueOn = '2026-10-15' WHERE id = ?").run(l.body.id);
  store.version++;
  const overdue = (await admin('GET', '/api/loans?status=overdue')).body;
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].daysLate, 20);
  assert.equal(overdue[0].fine, 40);
  assert.equal(overdue[0].guardianEmail, 'lin@family.example');
  const ret = await admin('POST', `/api/loans/${l.body.id}/return`, {});
  assert.equal(ret.body.daysLate, 20);
  assert.equal((await lend(2)).status, 200, 'the copy is back');
  // a librarian can lend; a teacher cannot
  await admin('POST', '/api/users', { username: 'lib', name: 'Librarian', role: 'librarian', password: 'password-123' });
  await admin('POST', '/api/users', { username: 'tch', name: 'Teacher', role: 'teacher', password: 'password-123' });
  const lib = client(app); await lib('POST', '/api/auth/login', { username: 'lib', password: 'password-123' });
  const tch = client(app); await tch('POST', '/api/auth/login', { username: 'tch', password: 'password-123' });
  assert.equal((await lib('POST', '/api/books', { title: 'Matilda', copies: 2 })).status, 200);
  assert.equal((await tch('POST', '/api/books', { title: 'X', copies: 1 })).status, 403);
  assert.equal((await tch('GET', '/api/books')).status, 200, 'staff can search the catalogue');
  assert.equal((await lib('GET', '/api/fees')).status, 403, 'librarians do not see fees');
  assert.equal((await lib('POST', '/api/register', { className: '1A', date: '2026-11-04', marks: [] })).status, 403);
});

test('transport: stops, capacity, one route per learner, trips; families see the bus', async () => {
  const { app, admin } = await school();
  const rt = (await admin('POST', '/api/routes', { name: 'North', vehicle: 'Bus 1', driver: 'Mr. Okoro', driverPhone: '555-0300', capacity: 2 })).body;
  const stops = (await admin('PUT', `/api/routes/${rt.id}/stops`, { stops: [{ name: 'Alder Street', amTime: '07:10', pmTime: '15:20' }, { name: 'Market', amTime: '07:25', pmTime: '15:05' }] })).body;
  assert.equal(stops.length, 2);
  const ride = (lid: number, stop = stops[0].id) => admin('PUT', `/api/riders/${lid}`, { routeId: rt.id, stopId: stop });
  assert.equal((await ride(1)).status, 200);
  assert.equal((await ride(2)).status, 200);
  assert.match((await ride(3)).body.error, /full/);
  assert.equal((await ride(1, stops[1].id)).status, 200, 'moving stop on the same route is fine');
  assert.match((await admin('PUT', `/api/routes/${rt.id}/stops`, { stops: [{ id: stops[0].id, name: 'Alder Street' }] })).body.error, /move them/);
  const list = (await admin('GET', '/api/routes')).body;
  const riders = list.items[0].riders;
  assert.equal(riders.length, 2);
  assert.equal(riders.find((x: any) => x.learnerId === 1).billed, true, 'learner 1 pays Transport');
  assert.equal(riders.find((x: any) => x.learnerId === 2).billed, false, 'learner 2 rides but is not billed');
  assert.equal((await admin('POST', '/api/trips', { routeId: rt.id, direction: 'AM', departedAt: '07:00', arrivedAt: '07:50' })).status, 200);
  assert.match((await admin('POST', '/api/trips', { routeId: rt.id, direction: 'AM' })).body.error, /already logged/);
  await admin('POST', '/api/users', { username: 'mum', name: 'Mum', role: 'parent', learnerIds: [1], password: 'password-123' });
  const p = client(app); await p('POST', '/api/auth/login', { username: 'mum', password: 'password-123' });
  const ex = (await p('GET', '/api/portal/learners/1/extras')).body;
  assert.deepEqual(ex.transport, { route: 'North', vehicle: 'Bus 1', driver: 'Mr. Okoro', driverPhone: '555-0300', stop: 'Market', amTime: '07:25', pmTime: '15:05' });
  assert.equal((await admin('DELETE', `/api/routes/${rt.id}`)).status, 400, 'riders first');
});
