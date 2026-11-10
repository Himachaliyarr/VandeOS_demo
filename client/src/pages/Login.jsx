import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorBanner } from '../components/Primitives.jsx';

export default function Login() {
  const { signIn, error, clearError } = useAuth();
  const [organizationSlug, setOrganizationSlug] = useState('vande-digital');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async event => { event.preventDefault(); setBusy(true); try { await signIn({ organizationSlug, email, password }); } catch {} finally { setBusy(false); } };
  return <div className="login-screen">
    <div className="login-art"><div className="login-brand"><div className="brand-mark">V<span>.</span></div><strong>vande<span>os</span></strong></div><div className="login-art-content"><p className="eyebrow">PEOPLE, IN SYNC</p><h1>Good work<br />starts with <em>good people.</em></h1><p>One calm place to look after your team, your time, and the work that matters.</p><div className="art-stats"><div><span className="art-stat-number">01</span><span>People first</span></div><div><span className="art-stat-number">02</span><span>Clear by design</span></div><div><span className="art-stat-number">03</span><span>Built for Vande</span></div></div></div><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="login-art-footer"><span>VANDE DIGITAL · INDIA</span><span>PHASE 01</span></div></div>
    <div className="login-form-side"><div className="login-mobile-brand"><div className="brand-mark">V<span>.</span></div><strong>vande<span>os</span></strong></div><div className="login-form-wrap"><div className="login-heading"><div className="login-icon"><LockKeyhole size={19} /></div><p className="eyebrow">YOUR WORKSPACE</p><h2>Welcome back</h2><p>Sign in to continue to your Vande OS account.</p></div><form className="login-form" onSubmit={submit}><ErrorBanner>{error}</ErrorBanner><label>Organization address<div className="input-wrap"><input value={organizationSlug} onChange={e => { setOrganizationSlug(e.target.value.toLowerCase()); clearError(); }} autoComplete="organization" placeholder="your-organization" required /></div></label><label>Work email<div className="input-wrap"><input type="email" value={email} onChange={e => { setEmail(e.target.value); clearError(); }} autoComplete="username" placeholder="you@company.com" required /></div></label><label>Password<div className="input-wrap"><input type="password" value={password} onChange={e => { setPassword(e.target.value); clearError(); }} autoComplete="current-password" placeholder="Enter your password" required /></div></label><button className="button button-primary button-wide login-submit" disabled={busy}>{busy ? 'Signing you in…' : <>Sign in <ArrowRight size={17} /></>}</button></form><div className="login-security"><ShieldCheck size={16} /><span>Protected by secure, role-based access</span></div><p className="signup-prompt">New organization? <Link to="/signup">Create a workspace</Link></p></div><div className="login-bottom"><span>© {new Date().getFullYear()} Vande OS</span><span>Private workspace</span></div></div>
  </div>;
}
