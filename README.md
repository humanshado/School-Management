# School Management

A web version of the **School Management** Excel workbook: daily registers, gradebook, report cards, fees and receipts, a school calendar, guardian e-mails and a dashboard. It uses the same screens, settings and rules as the workbook.

It comes loaded with the workbook's sample school (Alder Valley Academy: 14 classes, 280 learners, Term 3 of 2026).

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

| Workbook sheet | Web screen | What it does |
|---|---|---|
| Today | **Today** | Morning register, every class's register status, learners at risk / watch list (with e-mail), attendance by week, coming up, today's receipts |
| Attendance | **Attendance** | Register for any class and date: P / A / L / E, notes, last 5 days, term %, previous / next school day (skips weekends and holidays), message guardians of absent learners |
| Students | **Students** | Search and filter; learner profile with term at a glance (marks vs class average, attendance by week, last 10 days), details, absences, payments and payment plans |
| Classes, Teachers | **Classes**, **Teachers** | Add, edit and delete; renaming a class or teacher carries over to learners, registers and assessments |
| Gradebook | **Gradebook** | Term marks per subject with average, change and position; per-subject assessment and mark entry (Enter moves down the column), default assessments, weights and "out of" |
| Report Cards | **Report Cards** | Printable cards for one learner or the whole class (Save as PDF from the print dialog), teacher and principal comments, e-mail guardians |
| Fees & Receipts | **Fees & Receipts** | Billed / collected / overdue, every class, who owes what, record payments with numbered receipts (R-2026-0001…), payment plans, fee reminders |
| Dashboard | **Dashboard** | Register heat map for every class and school day, class leaderboard, attendance by week, grade spread, biggest movers; any term |
| School Calendar | **School Calendar** | Month view with register counts per day, terms, holidays and key dates |
| Communications | **Communications** | The four e-mail templates with `{tags}` |
| Admin | **Admin** | School details, rules, grades and fees, optional fees, default assessments, grading scale, lists, sample mode, backup / restore, clear data |

E-mails open in your own mail app (a `mailto:` link) for you to check and send, just as the workbook opened drafts in Outlook. Nothing is sent automatically.

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

The first time the app opens, it asks you to create the **admin** account. The admin then adds staff under **Admin › Users & roles**.

| | Admin | Teacher | Bursar |
|---|---|---|---|
| Today, Students, Classes, Teachers, Calendar, Dashboard | ✓ | view (no fee figures) | view |
| Registers, Gradebook, the teacher's report-card comment | ✓ | own class* | – |
| Fees, receipts, payment plans, fee reminders | ✓ | – | ✓ |
| Add / edit learners, classes, teachers; settings; templates; principal's comment; users; backups | ✓ | – | – |

\* A teacher login is linked to a name on the Teachers list and works on the classes where that teacher is class teacher. A teacher login that is not linked can work on every class. Other classes' registers and marks are view only.

- The **server** enforces every rule. Hiding a button is only for convenience.
- Passwords are stored as salted scrypt hashes. A session is a random token in an HttpOnly cookie, and it ends after 12 hours without use.
- Five wrong passwords lock that username for 5 minutes on that computer.
- Changing a password signs that person out on their other devices. An admin resetting someone's password, changing their role or disabling them signs them out everywhere.
- There is always at least one active admin.
- Requests that change data must come from the app's own pages, which blocks forged form posts from other websites.
- Backups (Download backup) do **not** include user accounts or passwords. Restoring a backup or loading the sample data keeps the existing users.
- A forgotten password is reset by an admin. If the only admin forgets theirs, stop the app and delete the `users` and `sessions` tables, for example with `sqlite3 server/data/school.db "DELETE FROM sessions; DELETE FROM users;"`. The next visit then shows the setup screen again.

**On a network:** logins protect the data, but traffic is plain HTTP. Put it behind HTTPS (a reverse proxy such as Caddy or nginx) before using it beyond one trusted local network.

## Code layout

```
server/src/engine.ts   the calculations (port of the workbook's SMS_Recalc)
server/src/api.ts      REST API with validation
server/src/db.ts       SQLite tables, seeding, backup / restore
server/test/           engine and API tests            npm test
client/src/pages/      one file per screen (React + Vite + TypeScript)
client/src/components/ register, payments / receipts, shared UI
scripts/import_xlsm.py Excel workbook -> JSON seed
```
