# School Management

A web version of the **School Management** Excel workbook, grown into a full school management system:
- daily registers, gradebook, report cards with GPA, fees, invoices and receipts;
- timetable, cover and exams;
- admissions, a parent/student portal, homework, notices;
- library, transport, staff HR and payroll;
- reports and an activity log.

It comes loaded with the workbook's sample school (Alder Valley Academy: 14 classes, 280 learners, Term 3 of 2026), plus demo data for the newer modules.

## Run it

You need **Node.js 22.13 or newer**. Nothing else: the database is the SQLite built into Node, and Node runs the server's TypeScript directly (no build tools for the server).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The API runs on port 3001 and the page reloads as you edit code.

For a production build served by one process on http://localhost:3001:

```bash
npm run build
```

```bash
npm start
```

| Setting | Default | |
|---|---|---|
| `PORT` | `3001` | port of the server |
| `DB_PATH` | `server/data/school.db` | the SQLite database file; created and loaded with the sample data the first time |

### If the page says the API server is not answering

`npm run dev` starts two things: the API (`[api]` lines) and the web page (`[web]` lines). If only the web page starts, look at the `[api]` lines in that terminal:

- **"needs Node.js 22.13 or newer"**: run `node -v`; install the current LTS from https://nodejs.org.
- **"Port 3001 is already in use"**: the app is already running in another terminal. Close it first.
- **"dyld: Symbol not found: _SecTrustCopyCertificateChain"** (macOS 11 or older): an esbuild newer than 0.26 was installed. The project pins esbuild 0.25.12, which supports macOS 11, so pull the latest code, delete `node_modules` and run `npm install` again.

## Screens

**From the workbook**
| Screen | What it does |
|---|---|
| **Today** | Morning register, every class's register, learners at risk / watch list, attendance by week, notices, coming up, receipts |
| **Attendance** | Registers for any class and date (P / A / L / E, notes), previous / next school day, absence e-mails |
| **Students** | Search; learner profile: term at a glance, details, documents, attendance, fees (invoice, statement, receipts, plans), history |
| **Classes, Teachers** | Add, edit, delete; renames carry over |
| **Gradebook** | Term marks, average, GPA, change and position; per-assessment mark entry |
| **Report Cards** | Printable cards (one learner or the class) with GPA and comments; e-mail guardians |
| **Fees & Receipts** | Billed / collected / overdue, who owes what, payments and receipts, payment plans, reminders, **invoices** for a class |
| **Dashboard, School Calendar, Communications, Admin** | As in the workbook |

**New**
| Screen | What it does |
|---|---|
| **Timetable** | Weekly lessons by class, teacher or room (no teacher or room in two places at once); **cover** for absent teachers, offering only free teachers; **exam timetable** with clash checks |
| **Homework** | Homework and study materials (files or links: videos, Zoom / Teams classes) per class |
| **Notice board** | Notices to everyone, staff, families or one class |
| **Admissions** | Public form at `/apply` (closed until an admin opens it) with document uploads, stage pipeline, interview dates, **Enrol** into a class |
| **Reports** | 13 reports with charts and CSV: enrolment, attendance (range, chronic absence, by term), subject averages, top / bottom performers, results by term, collections, arrears ageing, collection rate, admissions funnel, library, transport, staff & payroll |
| **Library** | Catalogue with copies, loans to learners and staff, returns, renewals, overdue list and reminder drafts, optional fines |
| **Transport** | Routes, stops with times, riders (seat limits), route sheets, trip log; flags riders not billed for transport |
| **Staff & payroll** | Staff records and documents, staff register, leave (working days, approval), pay items, monthly pay runs (prepared, approved, paid), payslips, bank CSV |
| **Activity** | Every change: who, what, when (admins) |
| **Portal** | What parents and students see: overview, report card, attendance, homework and materials, timetable and exams, fees (invoice, statement, receipts), notices, library books and the bus |

E-mails open in your own mail app (a `mailto:` link) for you to check and send. Nothing is sent automatically.

**Not included:**
- SMS or push messages, and automatic e-mail sending. Each needs an account with a sending service.
- Online fee payments. These need a merchant account with a payment provider.
- Biometric or RFID attendance.
- Live bus GPS. This needs trackers in the buses.

## The rules (same as the workbook's `SMS_Recalc`)

They live in `server/src/engine.ts` and are covered by `server/test/engine.test.ts`.

- **Attendance**: registers taken for the class this term, up to today. A and E count as absent; L counts as present unless *Count late as present* is No.
- **Term mark** per subject: the weighted average of that term's assessments, each scaled to 100 by its "out of", rounded half up. The **term average** is the mean of the subject marks. **Change** is compared with the term before on the calendar, and **position** is the rank in the class.
- **Fees**: the grade's tuition + books & activities, plus any optional fees the learner takes. Fees are **overdue** after the term's fees-due date, unless the learner has a payment plan whose next instalment is not yet late.
- **Flags**: attendance under the at-risk level, average down by the at-risk drop or more, fees overdue. **2+ flags = at risk; 1 = watch list.**
- **Sample mode** (Admin) pins "today" to a fixed date so the sample data looks live. Turn it off, or clear the sample data, to run on the real date.

## Your own data from Excel

`scripts/import_xlsm.py` reads a copy of the workbook (all the DB sheets, Admin, School Calendar and Communications) and writes the JSON the app loads:

```bash
pip install openpyxl
```

```bash
python3 scripts/import_xlsm.py path/to/School_Management.xlsm server/data/sample.json
```

```bash
npm run seed
```

`npm run seed` **replaces** the database with that file. Admin also has **Download backup** and **Restore backup** (the same JSON format) and **Clear all school data**, which keeps settings, lists, calendar and templates.

## Logins and roles

The first time the app opens, it asks you to create the **admin** account. The admin then adds everyone else under **Admin › Users & roles**. A learner's profile has a **Parent login** button that fills in the guardian's details.

| Role | Can use |
|---|---|
| **Admin** | Everything |
| **Teacher** | Registers, gradebook, homework and the teacher's report-card comment for **their own class*** (others view only); timetable, notices, reports on learners. No fee figures. |
| **Bursar** | Fees, invoices, receipts, plans, reminders; **staff & payroll** (prepares pay runs; an admin approves) |
| **Librarian** | The library |
| **Parent** | The **portal** only, for the children linked to their login |
| **Student** | The **portal** only, for their own record |

\* A teacher login is linked to a name on the Teachers list and works on the classes where that teacher is class teacher. An unlinked teacher login can work on every class. Admissions, transport, settings, users, backups and the activity log are for admins.

- The **server** enforces every rule. Hiding a button is only for convenience.
- Passwords are stored as salted scrypt hashes. A session is a random token in an HttpOnly cookie, and it ends after 12 hours without use.
- Five wrong passwords lock that username for 5 minutes on that computer.
- Changing a password signs that person out on their other devices. An admin resetting someone's password, changing their role or disabling them signs them out everywhere.
- There is always at least one active admin.
- Requests that change data must come from the app's own pages, which blocks forged form posts from other websites.
- Backups (Download backup) include the school's records but **not** user accounts, passwords or uploaded files. Uploaded files are in `server/data/uploads`, so copy that folder with your backups. Restoring a backup or loading the sample data keeps the existing users.
- A forgotten password is reset by an admin. If the only admin forgets theirs, stop the app and delete the `users` and `sessions` tables, for example with `sqlite3 server/data/school.db "DELETE FROM sessions; DELETE FROM users;"`. The next visit then shows the setup screen again.

**On a network:** logins protect the data, but traffic is plain HTTP. Put it behind HTTPS (a reverse proxy such as Caddy or nginx) before using it beyond one trusted local network.

## Activity log

**Admin › Activity** shows every change made in the app: who did it (with their role), when, and what changed.

- **What's recorded:** registers (only the marks that changed), marks (old → new), assessments, report-card comments, learners, classes, teachers, payments, payment plans, settings, users, backups and data resets. Logins, logouts, failed logins and lockouts are recorded too.
- **What each entry keeps:** a plain-English summary, plus details showing each changed field before → after. Anything deleted (a payment, a learner, an assessment and its marks) is kept in full in the entry, so it can be put back by hand.
- **Never recorded:** passwords.
- **Finding entries:** filter by person, area, dates or text, and download what's shown as CSV for Excel. Each learner's profile also has a **History** tab.
- **Who can see it:** admins only.
- **Tamper-resistant from the app:** entries can't be edited or deleted. "Clear all school data", "Load sample data" and "Restore backup" don't touch the log; they're recorded in it.
- **Not protected from the database file:** someone with direct access to `server/data/school.db` could still change it, so keep that file somewhere only the admin can reach.

## Code layout

```
server/src/engine.ts      the calculations (port of the workbook's SMS_Recalc)
server/src/api.ts         learners, classes, registers, gradebook, report cards, fees
server/src/auth*.ts       logins, roles, users          server/src/activity.ts   activity log
server/src/portal.ts      parent / student portal       server/src/files.ts      uploads
server/src/learning.ts    homework, materials, notices  server/src/schedule.ts   timetable, cover, exams
server/src/admissions.ts  online applications           server/src/resources.ts  library, transport
server/src/hr.ts          staff, leave, payroll         server/src/analytics.ts  reports, GPA, invoices, statements
server/test/              tests (npm test)
client/src/pages/         one file per screen (React + Vite + TypeScript)
scripts/import_xlsm.py    Excel workbook -> JSON seed
```
