import { CalendarPlus, Check, Clock3, FileCheck2, MessageSquareText, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import { api, formatDate, initials, titleCase } from '../lib/api.js';
import { Badge, EmptyState, ErrorBanner, Loading, PageHeader, Panel, StatusBadge, SuccessBanner, TableWrap } from '../components/Primitives.jsx';

const blank = { leaveType: 'ANNUAL', startDate: '', endDate: '', reason: '' };
const dayCount = (start, end) => start && end ? Math.max(1, Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000) + 1) : 0;

export default function Leaves() {
  const { user } = useAuth();
  const isStaff = ['SUPER_ADMIN', 'HR'].includes(user.role);
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState(isStaff ? 'PENDING' : 'ALL');

  const load = async () => {
    setBusy(true); setError('');
    try {
      if (isStaff) {
        const query = new URLSearchParams({ limit: '100' }); if (filter !== 'ALL') query.set('status', filter);
        const result = await api(`/leave-requests?${query}`); setRequests(result.data.requests);
      } else {
        const result = await api('/leave-requests/me'); setRequests(result.data.requests);
      }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [filter]);

  const submit = async event => {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try {
      const result = await api('/leave-requests', { method: 'POST', body: form });
      setSuccess(result.message); setForm(blank); setShowModal(false); await load();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const review = async (request, decision) => {
    const label = decision === 'APPROVED' ? 'approve' : 'decline';
    if (!window.confirm(`${label[0].toUpperCase()}${label.slice(1)} ${request.user?.name}’s ${titleCase(request.leaveType).toLowerCase()} leave request?`)) return;
    setError(''); setSuccess('');
    try { const result = await api(`/leave-requests/${request._id}/review`, { method: 'POST', body: { decision, reviewerNote: '' } }); setSuccess(result.message); await load(); }
    catch (err) { setError(err.message); }
  };

  const cancel = async request => {
    try { await api(`/leave-requests/${request._id}/cancel`, { method: 'POST' }); setSuccess('Leave request cancelled.'); await load(); }
    catch (err) { setError(err.message); }
  };

  return <>
    <PageHeader eyebrow={isStaff ? 'PEOPLE & CULTURE' : 'YOUR TIME, YOURS'} title={isStaff ? 'Time off' : 'Time off'} description={isStaff ? 'Review leave requests directly, and keep your team’s time off organized.' : 'Plan a little breathing room. Submit a request and see its status here.'} action={<button className="button button-primary" onClick={() => { setForm(blank); setShowModal(true); }}><CalendarPlus size={17} /> Request time off</button>} />
    <ErrorBanner>{error}</ErrorBanner><SuccessBanner>{success}</SuccessBanner>
    {isStaff && <div className="leave-summary-row"><div className="leave-summary-card"><span className="leave-summary-icon leave-icon-amber"><Clock3 size={17} /></span><div><strong>{requests.filter(row => row.status === 'PENDING').length}</strong><span>Awaiting review</span></div></div><div className="leave-summary-card"><span className="leave-summary-icon leave-icon-green"><FileCheck2 size={17} /></span><div><strong>{requests.filter(row => row.status === 'APPROVED').length}</strong><span>Approved in this view</span></div></div><div className="leave-summary-card"><span className="leave-summary-icon leave-icon-blue"><MessageSquareText size={17} /></span><div><strong>HR</strong><span>Direct approval route</span></div></div></div>}
    <Panel title={isStaff ? 'Leave requests' : 'Your requests'} subtitle={isStaff ? 'HR and the Owner can approve or decline requests directly.' : 'Requests are sent to HR for direct review.'} action={isStaff && <select className="filter-select" value={filter} onChange={e => setFilter(e.target.value)}><option value="PENDING">Needs review</option><option value="APPROVED">Approved</option><option value="REJECTED">Declined</option><option value="CANCELLED">Cancelled</option><option value="ALL">All requests</option></select>}>
      {busy ? <Loading /> : requests.length ? <TableWrap><thead><tr>{isStaff && <th>Person</th>}<th>Leave type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Status</th>{isStaff && <th>Review</th>}{!isStaff && <th />}</tr></thead><tbody>{requests.map(request => <tr key={request._id}>{isStaff && <td><div className="person-cell"><span className="avatar avatar-small">{initials(request.user?.name)}</span><div><strong>{request.user?.name}</strong><small>{request.user?.department?.name || request.user?.employeeId}</small></div></div></td>}<td className="cell-strong">{titleCase(request.leaveType)}</td><td><div>{formatDate(request.startDate)}<span className="date-separator">–</span>{formatDate(request.endDate)}</div><small className="division-sub">Requested {formatDate(request.createdAt)}</small></td><td><span className="day-count">{dayCount(request.startDate.slice(0, 10), request.endDate.slice(0, 10))}</span></td><td className="reason-cell" title={request.reason}>{request.reason}</td><td><StatusBadge status={request.status} /></td>{isStaff && <td>{request.status === 'PENDING' ? <div className="review-actions"><button className="review-button review-approve" onClick={() => review(request, 'APPROVED')} title="Approve"><Check size={15} /> Approve</button><button className="review-button review-reject" onClick={() => review(request, 'REJECTED')} title="Decline"><X size={15} /></button></div> : <span className="reviewer-text">{request.reviewedBy?.name || '—'}</span>}</td>}{!isStaff && <td>{request.status === 'PENDING' && <button className="text-link" onClick={() => cancel(request)}>Cancel request <X size={14} /></button>}</td>}</tr>)}</tbody></TableWrap> : <EmptyState title={isStaff ? filter === 'PENDING' ? 'You’re all caught up' : 'No requests in this view' : 'No time off requests yet'} text={isStaff ? filter === 'PENDING' ? 'New requests will appear here as your team sends them.' : 'Try another status filter.' : 'When you need time away, start with a quick request.'} />}
    </Panel>
    <div className="leave-policy-note"><span className="policy-glyph">✳</span><div><strong>How approvals work</strong><p>HR reviews and approves leave directly. The Owner also has HR review access. Employees can cancel requests while they are still pending.</p></div></div>
    {showModal && <Modal title="Request time off" onClose={() => setShowModal(false)} size="small"><p className="modal-copy">Your request goes directly to HR for review.</p><form className="form-stack" onSubmit={submit}><ErrorBanner>{error}</ErrorBanner><label>Leave type<select value={form.leaveType} onChange={e => setForm({ ...form, leaveType: e.target.value })}><option value="ANNUAL">Annual leave</option><option value="SICK">Sick leave</option><option value="PERSONAL">Personal leave</option><option value="UNPAID">Unpaid leave</option><option value="OTHER">Other</option></select></label><div className="form-grid two-cols"><label>First day<input type="date" value={form.startDate} min={new Date().toISOString().slice(0, 10)} onChange={e => setForm({ ...form, startDate: e.target.value, endDate: form.endDate && form.endDate < e.target.value ? e.target.value : form.endDate })} required /></label><label>Last day<input type="date" value={form.endDate} min={form.startDate || new Date().toISOString().slice(0, 10)} onChange={e => setForm({ ...form, endDate: e.target.value })} required /></label></div><label>Reason<textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} rows="4" placeholder="A short note for HR" minLength="5" maxLength="1000" required /></label>{dayCount(form.startDate, form.endDate) > 0 && <div className="days-preview"><CalendarPlus size={15} />{dayCount(form.startDate, form.endDate)} calendar day{dayCount(form.startDate, form.endDate) > 1 ? 's' : ''} requested</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowModal(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Sending…' : 'Send request'}</button></div></form></Modal>}
  </>;
}
