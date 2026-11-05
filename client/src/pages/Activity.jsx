import { Activity as ActivityIcon, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, formatDate, formatTime, initials, titleCase } from '../lib/api.js';
import { EmptyState, ErrorBanner, Loading, PageHeader, Panel, TableWrap } from '../components/Primitives.jsx';

const actionColor = action => action?.includes('LEAVE') ? 'amber' : action?.includes('ATTENDANCE') ? 'blue' : action?.includes('AUTH') || action?.includes('PASSWORD') ? 'purple' : 'mint';
const descriptionFor = log => {
  const actor = log.actor?.name || 'System';
  const subject = log.entity === 'User' && log.details?.employeeId ? `employee ${log.details.employeeId}` : log.entity;
  const actions = {
    OWNER_BOOTSTRAPPED: 'set up the first Owner account', EMPLOYEE_CREATED: 'added a team member', EMPLOYEE_UPDATED: 'updated a team member', EMPLOYEE_DEACTIVATED: 'deactivated a team member',
    ATTENDANCE_CHECK_IN: `checked in by ${log.details?.method === 'OFFICE_GPS' ? 'office GPS' : 'remote web'}`, ATTENDANCE_CHECK_OUT: 'checked out', LEAVE_REQUESTED: 'submitted a leave request',
    LEAVE_APPROVED: 'approved a leave request', LEAVE_REJECTED: 'declined a leave request', LEAVE_CANCELLED: 'cancelled a leave request', PASSWORD_CHANGED: 'changed their password',
    AUTH_LOGIN: 'signed in', AUTH_LOGOUT: 'signed out', OFFICE_SETTINGS_UPDATED: 'updated office attendance settings', SHIFT_CREATED: 'created a shift', SHIFT_UPDATED: 'updated a shift',
    DIVISION_CREATED: 'created a division', DIVISION_UPDATED: 'updated a division', DEPARTMENT_CREATED: 'created a department', DEPARTMENT_UPDATED: 'updated a department'
  };
  return { actor, text: actions[log.action] || titleCase(log.action), subject };
};

export default function Activity() {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { setLoading(true); api(`/audit-logs?page=${page}&limit=30`).then(result => { setLogs(result.data.logs); setPages(result.meta.pages || 1); setTotal(result.meta.total || 0); }).catch(err => setError(err.message)).finally(() => setLoading(false)); }, [page]);
  return <>
    <PageHeader eyebrow="SYSTEM RECORD" title="Audit history" description="A chronological record of the important actions in your workspace." action={<div className="audit-total"><ActivityIcon size={15} /> {total.toLocaleString()} events</div>} />
    <div className="audit-banner"><span><ShieldCheck size={17} /></span><div><strong>Workspace actions are recorded.</strong><p>Authentication, people changes, attendance, leave decisions, and office settings are tracked for accountability. Only the Owner can view this history.</p></div></div>
    <Panel title="Recent activity" subtitle="Newest events first">{error && <ErrorBanner>{error}</ErrorBanner>}{loading ? <Loading /> : logs.length ? <><div className="activity-timeline">{logs.map(log => { const copy = descriptionFor(log); return <div className="timeline-row" key={log._id}><div className={`timeline-mark mark-${actionColor(log.action)}`}>{initials(copy.actor)}</div><div className="timeline-body"><div><strong>{copy.actor}</strong><span>{copy.text}</span>{log.action.includes('EMPLOYEE') && log.details?.employeeId && <b>{log.details.employeeId}</b>}{log.action.includes('LEAVE') && log.details?.startDate && <b>{log.details.startDate} to {log.details.endDate}</b>}</div><small>{formatDate(log.createdAt)} at {formatTime(log.createdAt)} · {log.ipAddress || 'Local session'}</small></div><span className={`timeline-tag tag-${actionColor(log.action)}`}>{titleCase(log.action)}</span></div>; })}</div><div className="pagination-row"><span>Page <strong>{page}</strong> of {pages}</span><div><button className="icon-button" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft size={17} /></button><button className="icon-button" disabled={page >= pages} onClick={() => setPage(value => Math.min(pages, value + 1))}><ChevronRight size={17} /></button></div></div></> : <EmptyState title="No activity has been recorded" text="Important workspace actions will show here." />}</Panel>
  </>;
}
