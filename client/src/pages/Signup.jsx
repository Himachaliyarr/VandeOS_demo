import { ArrowLeft, ArrowRight, Building2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/Primitives.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';

async function loadRazorpay() {
  if (window.Razorpay) return;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-razorpay-checkout]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.dataset.razorpayCheckout = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load Razorpay checkout. Check your connection and try again.'));
    document.body.appendChild(script);
  });
  if (!window.Razorpay) throw new Error('Razorpay checkout did not initialize.');
}

export default function Signup() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ organizationName: '', slug: '', ownerName: '', ownerEmail: '', password: '' });
  const [payment, setPayment] = useState(null);
  const [verification, setVerification] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const completeSignup = async result => {
    const paymentDetails = {
      slug: form.slug,
      orderId: result.orderId || result.razorpay_order_id,
      paymentId: result.paymentId || result.razorpay_payment_id,
      signature: result.signature || result.razorpay_signature
    };
    setVerification(paymentDetails);
    setBusy(true);
    setError('');
    try {
      await api('/tenants/verify-payment', { method: 'POST', body: paymentDetails });
      await signIn({ organizationSlug: form.slug, email: form.ownerEmail, password: form.password });
      navigate('/', { replace: true });
    } catch (verificationError) {
      setError(verificationError.message);
    } finally {
      setBusy(false);
    }
  };

  const openCheckout = async order => {
    await loadRazorpay();
    const checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: order.name,
      description: order.description,
      order_id: order.orderId,
      prefill: { name: form.ownerName, email: form.ownerEmail },
      handler: completeSignup,
      modal: { ondismiss: () => setBusy(false) }
    });
    checkout.on('payment.failed', result => {
      setError(result.error?.description || 'Payment failed. Please try again.');
      setBusy(false);
    });
    checkout.open();
  };

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (verification) {
        await completeSignup(verification);
      } else if (payment) {
        await openCheckout(payment);
      } else {
        const result = await api('/tenants/signup', { method: 'POST', body: form });
        setPayment(result.data.payment);
        await openCheckout(result.data.payment);
      }
    } catch (signupError) {
      setError(signupError.message);
      setBusy(false);
    }
  };

  return <div className="login-screen">
    <div className="login-art"><div className="login-brand"><div className="brand-mark">V<span>.</span></div><strong>vande<span>os</span></strong></div><div className="login-art-content"><p className="eyebrow">ONE WORKSPACE, YOUR ORGANIZATION</p><h1>Good work<br />starts with <em>good people.</em></h1><p>Create an organization workspace with its own isolated data and admin account.</p><div className="art-stats"><div><span className="art-stat-number">01</span><span>Private data</span></div><div><span className="art-stat-number">02</span><span>People first</span></div><div><span className="art-stat-number">03</span><span>Built for work</span></div></div></div><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="login-art-footer"><span>VANDE OS · INDIA</span><span>SECURE WORKSPACE</span></div></div>
    <div className="login-form-side"><div className="login-mobile-brand"><div className="brand-mark">V<span>.</span></div><strong>vande<span>os</span></strong></div><div className="login-form-wrap"><div className="login-heading"><div className="login-icon"><Building2 size={19} /></div><p className="eyebrow">GET STARTED</p><h2>Create your workspace</h2><p>Pay the one-time ₹500 joining fee with UPI apps such as Google Pay (when enabled), or another method offered in secure Razorpay Checkout.</p><small className="field-hint">Payments settle to the bank account linked to the Vande OS Razorpay merchant account.</small></div><form className="login-form" onSubmit={submit}><ErrorBanner>{error}</ErrorBanner><label>Organization name<div className="input-wrap"><input value={form.organizationName} onChange={e => setForm({ ...form, organizationName: e.target.value })} autoComplete="organization" placeholder="Acme Technologies" required minLength="2" maxLength="120" disabled={!!payment} /></div></label><label>Organization address<div className="input-wrap"><input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="acme-technologies" pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength="3" maxLength="40" required disabled={!!payment} /></div><small className="field-hint">Use lowercase letters, numbers, and hyphens.</small></label><label>Workspace owner<div className="input-wrap"><input value={form.ownerName} onChange={e => setForm({ ...form, ownerName: e.target.value })} autoComplete="name" placeholder="Your full name" required minLength="2" maxLength="120" disabled={!!payment} /></div></label><label>Work email<div className="input-wrap"><input type="email" value={form.ownerEmail} onChange={e => setForm({ ...form, ownerEmail: e.target.value })} autoComplete="email" placeholder="you@company.com" required disabled={!!payment} /></div></label><label>Password<div className="input-wrap password-field"><PasswordInput value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="new-password" placeholder="At least 12 characters" required minLength="12" maxLength="128" disabled={!!payment} /></div></label><button className="button button-primary button-wide login-submit" disabled={busy}>{busy ? 'Opening secure checkout…' : <>{verification ? 'Retry payment verification' : payment ? 'Retry payment' : 'Pay ₹500 and create workspace'} <ArrowRight size={17} /></>}</button></form><p className="signup-prompt"><Link to="/login"><ArrowLeft size={14} /> Back to sign in</Link></p></div><div className="login-bottom"><span>© {new Date().getFullYear()} Vande OS</span><span>Secure payment by Razorpay</span></div></div>
  </div>;
}
