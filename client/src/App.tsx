import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { ErrorBox, Loading, MetaContext } from './components/ui';
import { fmtDay, plural } from './format';
import type { Meta } from './types';
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

type NavItem = { to: string; label: string; icon: string; status: (m: Meta) => string; alert?: (m: Meta) => boolean };

const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Daily', items: [
    { to: '/today', label: 'Today', icon: '☀', status: (m) => `${plural(m.kpis.risk, 'learner')} at risk`, alert: (m) => m.kpis.risk > 0 },
    { to: '/attendance', label: 'Attendance', icon: '✓', status: (m) => m.kpis.regNot > 0 ? `${plural(m.kpis.regNot, 'register')} not taken` : `${plural(m.kpis.regTaken, 'register')} taken today`, alert: (m) => m.kpis.regNot > 0 },
    { to: '/fees', label: 'Fees & Receipts', icon: '$', status: (m) => m.settings.useFees ? `${m.kpis.overdueCount} overdue` : 'fees switched off', alert: (m) => m.settings.useFees && m.kpis.overdueCount > 0 },
  ] },
  { group: 'Learning', items: [
    { to: '/gradebook', label: 'Gradebook', icon: '✎', status: (m) => `${m.term} · week ${m.kpis.week}` },
    { to: '/report-cards', label: 'Report Cards', icon: '▤', status: (m) => `${m.kpis.ready} ready to print` },
    { to: '/dashboard', label: 'Dashboard', icon: '▦', status: () => 'registers · classes' },
  ] },
  { group: 'People', items: [
    { to: '/students', label: 'Students', icon: '☺', status: (m) => plural(m.kpis.learners, 'learner') },
    { to: '/classes', label: 'Classes', icon: '▣', status: (m) => plural(m.kpis.classes, 'class', 'classes') },
    { to: '/teachers', label: 'Teachers', icon: '♟', status: (m) => plural(m.teachers.length, 'teacher') },
  ] },
  { group: 'School', items: [
    { to: '/calendar', label: 'School Calendar', icon: '▥', status: () => 'terms · holidays · key dates' },
    { to: '/communications', label: 'Communications', icon: '✉', status: () => 'e-mail templates' },
    { to: '/admin', label: 'Admin', icon: '⚙', status: () => 'grading, fees, currency' },
  ] },
];

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  const reload = useCallback(async () => {
    try { setMeta(await api.get<Meta>('/meta')); setErr(null); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setNavOpen(false); }, [loc.pathname]);

  if (err && !meta) return <div className="boot"><ErrorBox error={`Could not reach the server: ${err}`} retry={reload} /></div>;
  if (!meta) return <div className="boot"><Loading /></div>;
  const s = meta.settings;

  return (
    <MetaContext.Provider value={{ meta, reload }}>
      <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
        <aside className="side">
          <div className="brand">
            <div className="logo" aria-hidden>▲</div>
            <div><b>{s.schoolName}</b><small>School Management</small></div>
          </div>
          <nav>
            {NAV.map((g) => (
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
            <button className="icon-btn menu" onClick={() => setNavOpen((o) => !o)} aria-label="Menu">☰</button>
            <span className="banner-info">{s.schoolName} · {meta.term} · week {meta.kpis.week} of {meta.kpis.weeks} · {fmtDay(meta.today)}</span>
            {s.sampleMode && <NavLink to="/admin" className="pill sample" title="Today is pinned to the sample date. Turn off in Admin.">SAMPLE DATA</NavLink>}
          </header>
          <main className="content">
            <Routes>
              <Route path="/" element={<Navigate to="/today" replace />} />
              <Route path="/today" element={<Today />} />
              <Route path="/students" element={<Students />} />
              <Route path="/students/:id" element={<Students />} />
              <Route path="/classes" element={<Classes />} />
              <Route path="/teachers" element={<Teachers />} />
              <Route path="/attendance" element={<Attendance />} />
              <Route path="/gradebook" element={<Gradebook />} />
              <Route path="/report-cards" element={<ReportCards />} />
              <Route path="/fees" element={<Fees />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/communications" element={<Communications />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<Navigate to="/today" replace />} />
            </Routes>
          </main>
        </div>
        <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      </div>
    </MetaContext.Provider>
  );
}
