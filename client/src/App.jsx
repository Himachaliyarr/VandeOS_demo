import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Modal from './components/Modal.jsx';
import { ErrorBanner, Loading, SuccessBanner } from './components/Primitives.jsx';
import { api } from './lib/api.js';
import { canAccessWorkspaceModule } from './lib/access.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Employees from './pages/Employees.jsx';
import Attendance from './pages/Attendance.jsx';
import Leaves from './pages/Leaves.jsx';
import Notifications from './pages/Notifications.jsx';
import Activity from './pages/Activity.jsx';
import Settings from './pages/Settings.jsx';
import { Reports, WorkspaceModule } from './pages/WorkspaceModule.jsx';
import { ClientPortal, StudentPortal } from './pages/Portals.jsx';

function PasswordGate() {
  const { user, refreshUser } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault(); setError(''); setSuccess('');
    if (form.newPassword.length < 12) return setError('Use at least 12 characters for your new password.');
    if (form.newPassword !== form.confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      await refreshUser(); setSuccess('Your password has been updated.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  if (!user?.mustChangePassword) return null;
  return <Modal title="Secure your account" size="small" closable={false}><p className="modal-copy">Set a new password to finish setting up your account. Use at least 12 characters.</p><form className="form-stack" onSubmit={submit}><ErrorBanner>{error}</ErrorBanner><SuccessBanner>{success}</SuccessBanner><label>Current temporary password<input autoComplete="current-password" type="password" value={form.currentPassword} onChange={e => setForm({ ...form, currentPassword: e.target.value })} required /></label><label>New password<input autoComplete="new-password" type="password" value={form.newPassword} onChange={e => setForm({ ...form, newPassword: e.target.value })} required minLength="12" /></label><label>Confirm new password<input autoComplete="new-password" type="password" value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} required minLength="12" /></label><button className="button button-primary button-wide" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button></form></Modal>;
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? <>{children}<PasswordGate /></> : <Navigate to="/login" replace />;
}

function StaffOnly({ children }) {
  const { user } = useAuth();
  return ['SUPER_ADMIN', 'HR'].includes(user.role) ? children : <Navigate to="/" replace />;
}

function OwnerOnly({ children }) {
  const { user } = useAuth();
  return user.role === 'SUPER_ADMIN' ? children : <Navigate to="/" replace />;
}

function PortalOnly({ role, children }) {
  const { user } = useAuth();
  return user.role === role ? children : <Navigate to="/" replace />;
}

function HomeRoute() {
  const { user } = useAuth();
  if (user.role === 'CLIENT') return <Navigate to="/portal/client" replace />;
  if (user.role === 'STUDENT') return <Navigate to="/portal/student" replace />;
  return <Dashboard />;
}

function ModuleOnly({ module, children }) {
  const { user } = useAuth();
  return canAccessWorkspaceModule(user, module) ? children : <Navigate to="/" replace />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  return loading ? <Loading /> : user ? <Navigate to="/" replace /> : <Login />;
}

function NotFound() { const navigate = useNavigate(); return <div className="not-found"><span className="not-found-mark">404</span><h1>That page isn’t here.</h1><p>The link may have changed or the page may be unavailable.</p><button className="button button-primary" onClick={() => navigate('/')}>Back to overview</button></div>; }

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginRoute />} />
    <Route path="/" element={<Protected><Layout /></Protected>}>
      <Route index element={<HomeRoute />} />
      <Route path="employees" element={<StaffOnly><Employees /></StaffOnly>} />
      <Route path="attendance" element={<Attendance />} />
      <Route path="leaves" element={<Leaves />} />
      <Route path="notifications" element={<Notifications />} />
      <Route path="activity" element={<OwnerOnly><Activity /></OwnerOnly>} />
      <Route path="settings" element={<OwnerOnly><Settings /></OwnerOnly>} />
      <Route path="crm" element={<ModuleOnly module="crm"><WorkspaceModule moduleKey="crm" /></ModuleOnly>} />
      <Route path="projects" element={<ModuleOnly module="projects"><WorkspaceModule moduleKey="projects" /></ModuleOnly>} />
      <Route path="academy" element={<ModuleOnly module="academy"><WorkspaceModule moduleKey="academy" /></ModuleOnly>} />
      <Route path="finance" element={<ModuleOnly module="finance"><WorkspaceModule moduleKey="finance" /></ModuleOnly>} />
      <Route path="marketing" element={<ModuleOnly module="marketing"><WorkspaceModule moduleKey="marketing" /></ModuleOnly>} />
      <Route path="inventory" element={<ModuleOnly module="inventory"><WorkspaceModule moduleKey="inventory" /></ModuleOnly>} />
      <Route path="support" element={<ModuleOnly module="support"><WorkspaceModule moduleKey="support" /></ModuleOnly>} />
      <Route path="automations" element={<ModuleOnly module="automations"><WorkspaceModule moduleKey="automations" /></ModuleOnly>} />
      <Route path="reports" element={<ModuleOnly module="reports"><Reports /></ModuleOnly>} />
      <Route path="portal/client" element={<PortalOnly role="CLIENT"><ClientPortal /></PortalOnly>} />
      <Route path="portal/student" element={<PortalOnly role="STUDENT"><StudentPortal /></PortalOnly>} />
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>;
}
