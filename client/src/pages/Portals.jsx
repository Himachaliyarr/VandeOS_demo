import { useEffect, useState } from 'react';
import { api, formatDate, titleCase } from '../lib/api.js';
import { ErrorBanner, Loading, PageHeader, Panel, SuccessBanner } from '../components/Primitives.jsx';
import './workspace.css';

function RecordList({ records, empty }) {
  if (!records?.length) return <p className="portal-empty">{empty}</p>;
  return <div className="portal-record-list">{records.map(record => <article key={record._id}>
    <div><strong>{record.title}</strong><span>{record.description || record.data?.courseName || record.data?.reference || titleCase(record.kind)}</span>{record.kind === 'invoice' && record.paymentEntries?.map(payment => <span key={payment.id}>Payment · {formatDate(payment.recordedAt)} · {payment.currency} {Number(payment.amount).toLocaleString('en-IN')}{payment.description ? ` · ${payment.description}` : ''}</span>)}</div>
    <aside><b>{titleCase(record.status).replaceAll('_', ' ')}</b>{record.dueDate && <small>Due {formatDate(record.dueDate)}</small>}{record.amount !== null && record.amount !== undefined && <small>{record.currency || 'INR'} {Number(record.amount).toLocaleString('en-IN')}{record.kind === 'invoice' ? ` · ${Number(record.paidAmount || 0).toLocaleString('en-IN')} paid` : ''}</small>}</aside>
  </article>)}</div>;
}

export function ClientPortal() {
  const [sections, setSections] = useState(null);
  const [error, setError] = useState('');
  const [ticket, setTicket] = useState({ title: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const load = async () => {
    try {
      const [profile, projects, invoices, tickets] = await Promise.all([
        api('/workspace/crm?kind=client'), api('/workspace/projects'), api('/workspace/finance?kind=invoice'), api('/workspace/support')
      ]);
      setSections({ profile: profile.data.records, projects: projects.data.records, invoices: invoices.data.records, tickets: tickets.data.records });
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => { load(); }, []);
  const submitTicket = async event => {
    event.preventDefault();
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      await api('/workspace/support', { method: 'POST', body: { kind: 'ticket', title: ticket.title, description: ticket.description, status: 'OPEN', data: {} } });
      setTicket({ title: '', description: '' });
      setSuccess('Your support request has been sent.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  if (!sections && !error) return <Loading label="Loading your client workspace" />;
  const profile = sections?.profile?.[0];
  return <>
    <PageHeader eyebrow="CLIENT WORKSPACE" title={profile?.title || 'Client portal'} description="Your shared delivery, billing, and support workspace." />
    <ErrorBanner>{error}</ErrorBanner><SuccessBanner>{success}</SuccessBanner>
    {sections && <div className="portal-grid">
      <Panel title="Projects" subtitle="Delivery work linked to your account"><RecordList records={sections.projects} empty="No projects have been shared with you yet." /></Panel>
      <Panel title="Invoices" subtitle="Billing records for your organization"><RecordList records={sections.invoices} empty="No invoices are available." /></Panel>
      <Panel title="Support requests" subtitle="Open a request and track its status"><RecordList records={sections.tickets} empty="No support requests yet." /><form className="portal-ticket-form" onSubmit={submitTicket}><label>Request title<input required maxLength="180" value={ticket.title} onChange={event => setTicket({ ...ticket, title: event.target.value })} /></label><label>Details<textarea required maxLength="5000" value={ticket.description} onChange={event => setTicket({ ...ticket, description: event.target.value })} /></label><button className="button button-primary" disabled={saving}>{saving ? 'Sending…' : 'Open support request'}</button></form></Panel>
    </div>}
  </>;
}

export function StudentPortal() {
  const [records, setRecords] = useState(null);
  const [responses, setResponses] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState('');
  const load = async () => {
    try {
      const result = await api('/workspace/academy');
      setRecords(result.data.records);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => { load(); }, []);
  const assignments = (records || []).filter(record => record.kind === 'assignment');
  const submittedAssignments = new Set(submissionsFor(records || []).map(record => String(record.parent?._id || record.parent)));
  const submitAssignment = async (event, assignment) => {
    event.preventDefault();
    if (!responses[assignment._id]?.trim()) return;
    setSaving(assignment._id);
    setError('');
    setSuccess('');
    try {
      await api('/workspace/academy', { method: 'POST', body: { kind: 'submission', title: `Submission: ${assignment.title}`, description: responses[assignment._id].trim(), status: 'PENDING', parent: assignment._id, data: {} } });
      setResponses(current => ({ ...current, [assignment._id]: '' }));
      setSuccess('Your submission has been sent for review.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving('');
    }
  };
  if (!records && !error) return <Loading label="Loading your Academy workspace" />;
  const submissions = (records || []).filter(record => record.kind === 'submission');
  return <>
    <PageHeader eyebrow="VANDE DIGITAL ACADEMY" title="Student portal" description="Your learning records, assignments, and submissions." />
    <ErrorBanner>{error}</ErrorBanner><SuccessBanner>{success}</SuccessBanner>
    {records && <div className="portal-grid">
      <Panel title="My learning" subtitle="Courses, batches, and enrollment status"><RecordList records={records.filter(record => ['student', 'course', 'batch', 'enrollment', 'certificate'].includes(record.kind))} empty="No courses or enrollment records are available yet." /></Panel>
      <Panel title="Assignments" subtitle="Submit your work for review">
        {assignments.length ? assignments.map(assignment => <form className="student-assignment" key={assignment._id} onSubmit={event => submitAssignment(event, assignment)}>
          <div><strong>{assignment.title}</strong><small>{assignment.description || 'Assignment'} · {titleCase(assignment.status)}</small></div>
          {submittedAssignments.has(String(assignment._id)) ? <small>Your work is submitted. See its review status below.</small> : <><textarea required maxLength="5000" placeholder="Write your response or submission notes" value={responses[assignment._id] || ''} onChange={event => setResponses({ ...responses, [assignment._id]: event.target.value })} /><button className="button button-primary" disabled={saving === assignment._id}>{saving === assignment._id ? 'Submitting…' : 'Submit work'}</button></>}
        </form>) : <p className="portal-empty">No assignments have been posted yet.</p>}
      </Panel>
      <Panel title="My submissions" subtitle="Recent work sent for review"><RecordList records={submissions} empty="Your submissions will appear here." /></Panel>
    </div>}
  </>;
}

function submissionsFor(records) {
  return records.filter(record => record.kind === 'submission');
}
