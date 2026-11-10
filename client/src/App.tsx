import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AUTH_EVENT, api } from './api';
import { ErrorBox, Field, Loading, MetaContext, Modal, useAction } from './components/ui';
import { ROLE_LABEL, fmtDay, plural } from './format';
import type { Meta, Perms, User } from './types';
import Login from './pages/Login';
import Portal from './pages/Portal';
import Homework from './pages/Homework';
import Notices from './pages/Notices';
import Timetable from './pages/Timetable';
import Admissions from './pages/Admissions';
import Apply from './pages/Apply';
import Library from './pages/Library';
import Transport from './pages/Transport';
import Hr from './pages/Hr';
import Today from './pages/Today';
import Students from './pages/Students';
import Classes from './pages/Classes';
import Teachers from './pages/Teachers';
import Attendance from './pages/Attendance';
import Gradebook from './pages/Gradebook';
import ReportCards from './pages/ReportCards';
import Fees from './pages/Fees';
import Dashboard from './pages/Dashboard';
import Calendar from './pages/Calendar';
import Communications from './pages/Communications';
import Admin from './pages/Admin';
import Activity from './pages/Activity';

type NavItem = { to: string; label: string; icon: string; status: (m: Meta) => string; alert?: (m: Meta) => boolean; allow?: (p: Perms) => boolean };
const teach = (p: Perms) => p.teach, fees = (p: Perms) => p.fees, admin = (p: Perms) => p.admin, admissions = (p: Perms) => p.admissions, library = (p: Perms) => p.library, transport = (p: Perms) => p.transport, hr = (p: Perms) => p.hr;

const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Daily', items: [
    { to: '/today', label: 'Today', icon: '☀', status: (m) => `${plural(m.kpis.risk, 'learner')} at risk`, alert: (m) => m.kpis.risk > 0 },
    { to: '/attendance', label: 'Attendance', icon: '✓', allow: teach, status: (m) => m.kpis.regNot > 0 ? `${plural(m.kpis.regNot, 'register')} not taken` : `${plural(m.kpis.regTaken, 'register')} taken today`, alert: (m) => m.kpis.regNot > 0 },
    { to: '/fees', label: 'Fees & Receipts', icon: '$', allow: fees, status: (m) => m.settings.useFees ? `${m.kpis.overdueCount} overdue` : 'fees switched off', alert: (m) => m.settings.useFees && m.kpis.overdueCount > 0 },
  ] },
  { group: 'Learning', items: [
    { to: '/gradebook', label: 'Gradebook', icon: '✎', allow: teach, status: (m) => `${m.term} · week ${m.kpis.week}` },
    { to: '/timetable', label: 'Timetable', icon: '▦', status: () => 'lessons · cover · exams' },
    { to: '/homework', label: 'Homework', icon: '✐', allow: teach, status: () => 'homework · materials' },
    { to: '/report-cards', label: 'Report Cards', icon: '▤', allow: teach, status: (m) => `${m.kpis.ready} ready to print` },
    { to: '/dashboard', label: 'Dashboard', icon: '▦', status: () => 'registers · classes' },
  ] },
  { group: 'People', items: [
    { to: '/admissions', label: 'Admissions', icon: '✚', allow: admissions, status: (m) => m.settings.admissionsOpen ? 'applications open' : 'applications closed' },
    { to: '/students', label: 'Students', icon: '☺', status: (m) => plural(m.kpis.learners, 'learner') },
    { to: '/classes', label: 'Classes', icon: '▣', status: (m) => plural(m.kpis.classes, 'class', 'classes') },
    { to: '/teachers', label: 'Teachers', icon: '♟', status: (m) => plural(m.teachers.length, 'teacher') },
  ] },
  { group: 'Resources', items: [
    { to: '/library', label: 'Library', icon: '📚', allow: library, status: () => 'books · loans' },
    { to: '/staff', label: 'Staff & payroll', icon: '👥', allow: hr, status: () => 'staff · leave · payroll' },
    { to: '/transport', label: 'Transport', icon: '🚌', allow: transport, status: () => 'routes · riders · trips' },
  ] },
  { group: 'School', items: [
    { to: '/notices', label: 'Notice board', icon: '📌', status: () => 'staff · families · classes' },
    { to: '/calendar', label: 'School Calendar', icon: '▥', status: () => 'terms · holidays · key dates' },
    { to: '/communications', label: 'Communications', icon: '✉', allow: admin, status: () => 'e-mail templates' },
    { to: '/activity', label: 'Activity', icon: '◷', allow: admin, status: () => 'who changed what' },
    { to: '/admin', label: 'Admin', icon: '⚙', allow: admin, status: () => 'grading, fees, currency' },
  ] },
];

/** Shows setup / login until there is a session, then the app. The online application form needs no login. */
export default function App() {
  const loc = useLocation();
  if (loc.pathname === '/apply') return <Apply />;
  return <Gate />;
}

function Gate() {
  const [state, setState] = useState<{ needsSetup: boolean; user: User | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  const check = useCallback(async () => {
    try { setState(await api.get('/auth/status')); setErr(null); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    const ended = () => { setNotice('Your session has ended. Please log in again.'); setState((s) => (s ? { ...s, user: null } : s)); };
    window.addEventListener(AUTH_EVENT, ended);
    return () => window.removeEventListener(AUTH_EVENT, ended);
  }, []);
  if (err && !state) return <div className="boot"><ErrorBox error={err} retry={check} /></div>;
  if (!state) return <div className="boot"><Loading /></div>;
  if (!state.user) return <Login setup={state.needsSetup} notice={notice} onDone={(user) => { setNotice(undefined); setState({ needsSetup: false, user }); }} />;
  const out = () => { setNotice(undefined); setState({ needsSetup: false, user: null }); };
  if (state.user.role === 'parent' || state.user.role === 'student') return <Portal key={state.user.id} onLogout={out} />;
  return <Shell key={state.user.id} onLogout={() => { setNotice(undefined); setState({ needsSetup: false, user: null }); }} />;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  const reload = useCallback(async () => {
    try { setMeta(await api.get<Meta>('/meta')); setErr(null); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setNavOpen(false); }, [loc.pathname]);

  if (err && !meta) return <div className="boot"><ErrorBox error={err} retry={reload} /></div>;
  if (!meta) return <div className="boot"><Loading /></div>;
  const s = meta.settings;
  const p = meta.perms;
  const guard = (ok: boolean, el: ReactNode) => (ok ? el : <Navigate to="/today" replace />);

  return (
    <MetaContext.Provider value={{ meta, reload }}>
      <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
        <aside className="side">
          <div className="brand">
            <div className="logo" aria-hidden>▲</div>
            <div><b>{s.schoolName}</b><small>School Management</small></div>
          </div>
          <nav>
            {NAV.map((g) => ({ ...g, items: g.items.filter((it) => !it.allow || it.allow(p)) })).filter((g) => g.items.length).map((g) => (
              <div key={g.group} className="nav-group">
                <div className="nav-title">{g.group}</div>
                {g.items.map((it) => (
                  <NavLink key={it.to} to={it.to} className="nav-item">
                    <span className="nav-icon" aria-hidden>{it.icon}</span>
                    <span className="nav-text"><b>{it.label}</b><small>{it.status(meta)}</small></span>
                    {it.alert?.(meta) && <span className="nav-alert" title="Needs attention">!</span>}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-foot">{s.schoolName}<br />{s.schoolContact.split(' · ').map((x) => <span key={x}>{x}<br /></span>)}</div>
        </aside>
        <div className="main">
          <header className="banner">
            <button className="icon-btn menu-btn" onClick={() => setNavOpen((o) => !o)} aria-label="Menu">☰</button>
            <span className="banner-info">{s.schoolName} · {meta.term} · week {meta.kpis.week} of {meta.kpis.weeks} · {fmtDay(meta.today)}</span>
            {s.sampleMode && <span className="pill sample" title="Today is pinned to the sample date. An admin can turn this off in Admin.">SAMPLE DATA</span>}
            <UserMenu user={meta.user} onLogout={onLogout} />
          </header>
          <main className="content">
            <Routes>
              <Route path="/" element={<Navigate to="/today" replace />} />
              <Route path="/today" element={<Today />} />
              <Route path="/students" element={<Students />} />
              <Route path="/students/:id" element={<Students />} />
              <Route path="/classes" element={<Classes />} />
              <Route path="/teachers" element={<Teachers />} />
              <Route path="/attendance" element={guard(p.teach, <Attendance />)} />
              <Route path="/gradebook" element={guard(p.teach, <Gradebook />)} />
              <Route path="/report-cards" element={guard(p.teach, <ReportCards />)} />
              <Route path="/fees" element={guard(p.fees, <Fees />)} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/communications" element={guard(p.admin, <Communications />)} />
              <Route path="/admin" element={guard(p.admin, <Admin />)} />
              <Route path="/activity" element={guard(p.admin, <Activity />)} />
              <Route path="/homework" element={guard(p.teach, <Homework />)} />
              <Route path="/notices" element={<Notices />} />
              <Route path="/timetable" element={<Timetable />} />
              <Route path="/admissions" element={guard(p.admissions, <Admissions />)} />
              <Route path="/library" element={guard(p.library, <Library />)} />
              <Route path="/transport" element={guard(p.transport, <Transport />)} />
              <Route path="/staff" element={guard(p.hr, <Hr />)} />
              <Route path="*" element={<Navigate to="/today" replace />} />
            </Routes>
          </main>
        </div>
        <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      </div>
    </MetaContext.Provider>
  );
}

function UserMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const logout = async () => { await api.post('/auth/logout').catch(() => {}); onLogout(); };
  return (
    <div className="user-menu">
      <button className="user-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="user-avatar" aria-hidden>{user.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()}</span>
        <span className="user-name">{user.name}<small>{ROLE_LABEL[user.role]}</small></span>
      </button>
      {open && (
        <>
          <div className="menu-scrim" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            <div className="menu-head"><b>{user.name}</b><small>@{user.username} · {ROLE_LABEL[user.role]}{user.teacherName ? ` · ${user.teacherName}` : ''}</small></div>
            <button role="menuitem" onClick={() => { setOpen(false); setPw(true); }}>Change password</button>
            <button role="menuitem" onClick={logout}>Log out</button>
          </div>
        </>
      )}
      {pw && <PasswordModal onClose={() => setPw(false)} />}
    </div>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const { busy, run } = useAction();
  const save = async () => {
    if (f.password !== f.confirm) return run(async () => { throw new Error('The two new passwords are not the same'); });
    if (await run(() => api.put('/auth/password', f), 'Password changed. Other devices have been logged out.')) onClose();
  };
  return (
    <Modal title="Change password" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={save}>Change password</button>
    </>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Current password" wide><input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoFocus /></Field>
        <Field label="New password" hint="At least 8 characters"><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="New password again"><input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
