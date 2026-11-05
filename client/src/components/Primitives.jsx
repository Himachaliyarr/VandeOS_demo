import { LoaderCircle, Search } from 'lucide-react';
import { titleCase } from '../lib/api.js';

export function PageHeader({ eyebrow, title, description, action }) {
  return <div className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action && <div className="page-action">{action}</div>}</div>;
}

export function Panel({ title, subtitle, action, children, className = '' }) {
  return <section className={`panel ${className}`}><div className="panel-heading"><div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}

export function Loading({ label = 'Loading your workspace' }) { return <div className="loading"><LoaderCircle className="spin" size={20} />{label}</div>; }
export function EmptyState({ title, text }) { return <div className="empty-state"><span className="empty-mark">✳</span><strong>{title}</strong><span>{text}</span></div>; }
export function ErrorBanner({ children }) { return children ? <div className="error-banner" role="alert">{children}</div> : null; }
export function SuccessBanner({ children }) { return children ? <div className="success-banner" role="status">{children}</div> : null; }
export function Badge({ children, tone = 'neutral' }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function StatusBadge({ status }) {
  const tone = ({ APPROVED: 'green', COMPLETE: 'green', ACTIVE: 'green', REJECTED: 'red', INACTIVE: 'red', PENDING: 'amber', IN_PROGRESS: 'blue', CANCELLED: 'neutral' })[status] || 'neutral';
  return <Badge tone={tone}>{titleCase(status)}</Badge>;
}
export function SearchField({ value, onChange, placeholder = 'Search' }) { return <label className="search-field"><Search size={16} /><input value={value} onChange={onChange} placeholder={placeholder} /></label>; }
export function Metric({ label, value, trend, icon, accent = 'mint' }) { return <div className={`metric metric-${accent}`}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong>{value ?? '—'}</strong>{trend && <small>{trend}</small>}</div>; }
export function TableWrap({ children }) { return <div className="table-scroll"><table>{children}</table></div>; }
