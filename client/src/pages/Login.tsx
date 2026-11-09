import { useState } from 'react';
import { api } from '../api';
import type { User } from '../types';

/** Log in, or (first run, no users yet) create the admin account. */
export default function Login({ setup, onDone, notice }: { setup: boolean; onDone: (u: User) => void; notice?: string }) {
  const [f, setF] = useState({ username: '', name: '', password: '', confirm: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (setup && f.password !== f.confirm) return setErr('The two passwords are not the same');
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ user: User }>(setup ? '/auth/setup' : '/auth/login', setup ? f : { username: f.username, password: f.password });
      onDone(r.user);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><div className="logo" aria-hidden>▲</div><b>School Management</b></div>
        <h1>{setup ? 'Create the admin account' : 'Log in'}</h1>
        {setup && <p className="muted small">This is the first time the app has been opened. The admin can add the other staff accounts (teachers and the bursar) under Admin › Users.</p>}
        {notice && !setup && <p className="login-notice">{notice}</p>}
        <label className="field"><span>Username</span>
          <input value={f.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" autoFocus required />
        </label>
        {setup && <label className="field"><span>Your name</span><input value={f.name} onChange={set('name')} autoComplete="name" required /></label>}
        <label className="field"><span>Password</span>
          <input type="password" value={f.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 8 : undefined} />
        </label>
        {setup && <label className="field"><span>Password again</span><input type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" required /></label>}
        {setup && <small className="muted">At least 8 characters.</small>}
        {err && <div className="error-box" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : setup ? 'Create account' : 'Log in'}</button>
        {!setup && <p className="muted small">Forgotten your password? Ask the school's admin to reset it.</p>}
      </form>
    </div>
  );
}
