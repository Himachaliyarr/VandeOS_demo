import { Bell, CheckCheck, ChevronRight, Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, formatDate, formatTime, titleCase } from '../lib/api.js';
import { Badge, EmptyState, ErrorBanner, Loading, PageHeader, Panel, SuccessBanner } from '../components/Primitives.jsx';

const iconFor = type => ({ LEAVE: '☷', SUCCESS: '✓', WARNING: '!', ATTENDANCE: '◷' })[type] || '✳';

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const load = async () => { setLoading(true); try { const result = await api('/notifications?limit=100'); setNotifications(result.data.notifications); setUnread(result.data.unread); } catch (err) { setError(err.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const markAll = async () => { try { await api('/notifications/read-all', { method: 'PATCH' }); setSuccess('All notifications marked as read.'); await load(); } catch (err) { setError(err.message); } };
  const markRead = async item => { if (!item.readAt) { try { await api(`/notifications/${item._id}/read`, { method: 'PATCH' }); setNotifications(old => old.map(n => n._id === item._id ? { ...n, readAt: new Date().toISOString() } : n)); setUnread(value => Math.max(0, value - 1)); } catch (err) { setError(err.message); } } };
  return <>
    <PageHeader eyebrow="STAY IN THE LOOP" title="Notifications" description="Updates about your attendance, requests, and Vande workspace." action={unread > 0 && <button className="button button-secondary" onClick={markAll}><CheckCheck size={16} /> Mark all as read</button>} />
    <ErrorBanner>{error}</ErrorBanner><SuccessBanner>{success}</SuccessBanner>
    <Panel title="Your updates" subtitle={`${unread} unread ${unread === 1 ? 'notification' : 'notifications'}`} className="notifications-panel">{loading ? <Loading /> : notifications.length ? <div className="notification-list">{notifications.map(item => <button key={item._id} className={`notification-row ${item.readAt ? 'notification-read' : 'notification-unread'}`} onClick={() => markRead(item)}><span className={`notification-glyph notification-${item.type.toLowerCase()}`}>{iconFor(item.type)}</span><span className="notification-copy"><span className="notification-title-line"><strong>{item.title}</strong>{!item.readAt && <i />}</span><span>{item.message}</span><small><Clock3 size={12} /> {formatDate(item.createdAt)} at {formatTime(item.createdAt)} · {titleCase(item.type)}</small></span><ChevronRight size={16} className="notification-chevron" /></button>)}</div> : <EmptyState title="You’re all caught up" text="New updates will arrive here when something needs your attention." />}</Panel>
    <div className="notifications-note"><Bell size={15} /> Notifications are private to your account. Leave decisions are recorded in the workspace audit history.</div>
  </>;
}
