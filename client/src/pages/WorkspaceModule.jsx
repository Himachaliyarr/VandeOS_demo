import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowUpRight, Plus, Search } from 'lucide-react';
import { api, formatDate, titleCase } from '../lib/api.js';
import Modal from '../components/Modal.jsx';
import { EmptyState, ErrorBanner, Loading, PageHeader, Panel, SuccessBanner, TableWrap } from '../components/Primitives.jsx';
import './workspace.css';

const modules = {
  crm: {
    eyebrow: 'CUSTOMER RELATIONSHIPS', title: 'CRM', description: 'Track leads, clients, deals, and relationship activity.',
    kinds: ['lead', 'client', 'contact', 'deal', 'activity'], statuses: ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST', 'ACTIVE', 'INACTIVE', 'OPEN', 'DONE'],
    fields: ['company', 'contactName', 'email', 'phone', 'source', 'industry']
  },
  projects: {
    eyebrow: 'DELIVERY WORKSPACE', title: 'Projects & tasks', description: 'Organize delivery plans, owners, milestones, and day-to-day work.',
    kinds: ['project', 'task'], statuses: ['PLANNED', 'ACTIVE', 'ON_HOLD', 'DONE', 'OPEN', 'IN_PROGRESS', 'REVIEW', 'BLOCKED'],
    fields: ['priority', 'milestone', 'clientName', 'estimateHours']
  },
  academy: {
    eyebrow: 'VANDE DIGITAL ACADEMY', title: 'Academy', description: 'Manage courses, batches, learners, enrollments, and assignments.',
    kinds: ['course', 'batch', 'student', 'enrollment', 'assignment', 'submission', 'certificate'], statuses: ['DRAFT', 'ACTIVE', 'COMPLETED', 'PENDING', 'APPROVED', 'REJECTED', 'PUBLISHED'],
    fields: ['courseName', 'studentEmail', 'batchName', 'instructor', 'duration', 'score']
  },
  finance: {
    eyebrow: 'FINANCE', title: 'Finance', description: 'Track invoices, payments, and expenses in one place.',
    kinds: ['invoice', 'payment', 'expense'], statuses: ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED', 'PENDING', 'APPROVED', 'REJECTED'],
    fields: ['reference', 'counterparty', 'category', 'paymentMethod']
  },
  marketing: {
    eyebrow: 'MARKETING STUDIO', title: 'Marketing', description: 'Plan campaigns and keep content moving from idea to publication.',
    kinds: ['campaign', 'content'], statuses: ['IDEA', 'DRAFT', 'SCHEDULED', 'PUBLISHED', 'PAUSED', 'COMPLETED'],
    fields: ['channel', 'audience', 'publishDate', 'campaignName']
  },
  inventory: {
    eyebrow: 'OPERATIONS', title: 'Inventory', description: 'Maintain stock records and log inventory movements.',
    kinds: ['item', 'movement'], statuses: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'RECORDED', 'CANCELLED'],
    fields: ['sku', 'category', 'unit']
  },
  support: {
    eyebrow: 'SERVICE DESK', title: 'Support', description: 'Capture requests, assign owners, and track resolution.',
    kinds: ['ticket', 'message'], statuses: ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'],
    fields: ['priority', 'requester', 'channel', 'resolution']
  },
  automations: {
    eyebrow: 'WORKFLOW ENGINE', title: 'Automations', description: 'Document automation rules and track their execution status.',
    kinds: ['rule', 'log'], statuses: ['ACTIVE', 'PAUSED', 'SUCCEEDED', 'FAILED'],
    fields: ['trigger', 'action', 'schedule', 'lastRun']
  }
};

const blank = module => ({ kind: module.kinds[0], title: '', description: '', status: module.statuses[0], data: {}, dueDate: '', amount: '', currency: 'INR', assignedTo: '', client: '', parent: '', portalEmail: '', stockQuantity: '0', minStockLevel: '0' });
const displayStatus = value => titleCase(value).replaceAll('_', ' ');

export function WorkspaceModule({ moduleKey }) {
  const config = modules[moduleKey];
  const [records, setRecords] = useState([]);
  const [people, setPeople] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', description: '' });
  const [stockItem, setStockItem] = useState(null);
  const [stockForm, setStockForm] = useState({ direction: 'IN', quantity: '', note: '' });
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewForm, setReviewForm] = useState({ decision: 'APPROVED', reviewNote: '' });
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => blank(config));
  const [clients, setClients] = useState([]);
  const [students, setStudents] = useState([]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ limit: '100' });
      query.set('page', String(page));
      if (search.trim()) query.set('search', search.trim());
      if (filter) query.set('kind', filter);
      if (statusFilter) query.set('status', statusFilter);
      const [result, team] = await Promise.all([
        api(`/workspace/${moduleKey}?${query}`),
        api('/employees?limit=100').catch(() => ({ data: { employees: [] } }))
      ]);
      setRecords(result.data.records);
      setMeta(result.meta || { pages: 1, total: result.data.records.length });
      setPeople(team.data.employees);
      if (['crm', 'projects', 'finance'].includes(moduleKey)) {
        const clientRecords = await api('/workspace/crm?kind=client&limit=100').catch(() => ({ data: { records: [] } }));
        setClients(clientRecords.data.records);
      }
      if (moduleKey === 'academy') {
        const studentRecords = await api('/workspace/academy?kind=student&limit=100').catch(() => ({ data: { records: [] } }));
        setStudents(studentRecords.data.records);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [moduleKey, filter, statusFilter, page]);
  useEffect(() => {
    setPage(1);
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const openNew = () => {
    setForm(blank(config));
    setEditing({ isNew: true });
    setError('');
    setSuccess('');
    setTemporaryPassword('');
  };
  const openEdit = record => {
    setForm({
      kind: record.kind, title: record.title, description: record.description || '', status: record.status,
      data: { ...(record.data || {}) }, dueDate: record.dueDate ? record.dueDate.slice(0, 10) : '',
      amount: record.amount ?? '', currency: record.currency || 'INR', assignedTo: record.assignedTo?._id || '',
      client: record.client?._id || '', parent: record.parent?._id || '', portalEmail: '',
      stockQuantity: String(record.stockQuantity ?? 0), minStockLevel: String(record.minStockLevel ?? 0)
    });
    setEditing(record);
    setError('');
    setSuccess('');
  };
  const close = () => setEditing(null);
  const updateData = (key, value) => setForm(current => ({ ...current, data: { ...current.data, [key]: value } }));
  const visibleStatuses = useMemo(() => config.statuses, [moduleKey]);

  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    const body = {
      ...form,
      data: Object.fromEntries(Object.entries(form.data).filter(([, value]) => value.trim())),
      dueDate: form.dueDate || null,
      amount: form.amount === '' ? null : Number(form.amount),
      assignedTo: form.assignedTo || null,
      client: form.client || null,
      parent: form.parent || null,
      portalEmail: form.portalEmail.trim() || undefined,
      ...(moduleKey === 'inventory' && form.kind === 'item' && editing.isNew ? { stockQuantity: Number(form.stockQuantity), minStockLevel: Number(form.minStockLevel) } : {}),
      ...(moduleKey === 'inventory' && form.kind === 'item' && !editing.isNew ? { minStockLevel: Number(form.minStockLevel) } : {})
    };
    try {
      const result = editing.isNew
        ? await api(`/workspace/${moduleKey}`, { method: 'POST', body })
        : await api(`/workspace/${moduleKey}/${editing._id}`, { method: 'PATCH', body });
      setSuccess(editing.isNew ? `${result.data.record.title} created.` : `${result.data.record.title} updated.`);
      setTemporaryPassword(result.data.temporaryPassword || '');
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const archive = async record => {
    if (!window.confirm(`Archive “${record.title}”? It will be removed from the active list.`)) return;
    try {
      await api(`/workspace/${moduleKey}/${record._id}/archive`, { method: 'POST' });
      setSuccess(`${record.title} archived.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const recordPayment = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api(`/workspace/finance/${paymentInvoice._id}/payments`, {
        method: 'POST',
        body: { amount: Number(paymentForm.amount), currency: paymentInvoice.currency || 'INR', description: paymentForm.description }
      });
      setSuccess(`Payment recorded for ${paymentInvoice.title}.`);
      setPaymentInvoice(null);
      setPaymentForm({ amount: '', description: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const adjustStock = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api(`/workspace/inventory/${stockItem._id}/movements`, { method: 'POST', body: { ...stockForm, quantity: Number(stockForm.quantity) } });
      setSuccess(`Stock updated for ${stockItem.title}.`);
      setStockItem(null);
      setStockForm({ direction: 'IN', quantity: '', note: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const reviewSubmission = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api(`/workspace/academy/${reviewTarget._id}/review`, { method: 'POST', body: reviewForm });
      setSuccess(`Submission ${reviewForm.decision.toLowerCase()}.`);
      setReviewTarget(null);
      setReviewForm({ decision: 'APPROVED', reviewNote: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const stockTone = record => record.stockQuantity === 0 ? 'OUT_OF_STOCK' : record.stockQuantity <= record.minStockLevel ? 'LOW_STOCK' : 'IN_STOCK';
  const immutable = record => record.kind === 'movement' || record.kind === 'payment' || record.kind === 'submission';

  return <>
    <PageHeader eyebrow={config.eyebrow} title={config.title} description={config.description} action={<button className="button button-primary" onClick={openNew}><Plus size={16} /> Add record</button>} />
    <Panel title="Workspace records" subtitle={`${meta.total} active records · changes are recorded in the audit history`} action={<div className="panel-filters"><label className="module-search"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search records" /></label><select className="filter-select" value={filter} onChange={event => { setPage(1); setFilter(event.target.value); }}><option value="">All types</option>{config.kinds.map(kind => <option key={kind} value={kind}>{titleCase(kind)}</option>)}</select><select className="filter-select" value={statusFilter} onChange={event => { setPage(1); setStatusFilter(event.target.value); }}><option value="">All statuses</option>{config.statuses.map(status => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></div>}>
      <ErrorBanner>{error}</ErrorBanner><SuccessBanner>{success}{temporaryPassword && <div className="portal-credential"><span>ONE-TIME PORTAL PASSWORD</span><code>{temporaryPassword}</code><small>Share it securely. The person will be required to set a new password at first sign-in.</small></div>}</SuccessBanner>
      {loading ? <Loading label={`Loading ${config.title.toLowerCase()}`} /> : records.length ? <TableWrap><thead><tr><th>Record</th><th>Type</th><th>Status</th>{moduleKey === 'inventory' && <th>Stock</th>}<th>Owner</th><th>Due</th><th>{moduleKey === 'finance' ? 'Balance' : 'Updated'}</th><th /></tr></thead><tbody>{records.map(record => <tr key={record._id}>
        <td><button className="person-cell person-button" onClick={() => openEdit(record)}><span className="person-lines"><strong>{record.title}</strong><small>{record.description || record.data?.company || record.data?.reference || 'Open record'}</small></span></button></td>
        <td>{titleCase(record.kind)}</td><td><span className="role-label">{displayStatus(moduleKey === 'inventory' && record.kind === 'item' ? stockTone(record) : record.status)}</span></td>
        {moduleKey === 'inventory' && <td>{record.kind === 'item' ? `${record.stockQuantity ?? 0} ${record.data?.unit || 'units'} · min ${record.minStockLevel ?? 0}` : record.quantity ? `${record.data?.direction || ''} ${record.quantity}` : '—'}</td>}
        <td>{record.assignedTo?.name || record.createdBy?.name || '—'}</td><td>{formatDate(record.dueDate)}</td>
        <td>{moduleKey === 'finance' && record.kind === 'invoice' ? `${record.currency || 'INR'} ${(Math.max(0, (record.amount || 0) - (record.paidAmount || 0))).toLocaleString('en-IN')} due` : record.amount !== null && record.amount !== undefined ? `${record.currency || 'INR'} ${Number(record.amount).toLocaleString('en-IN')}` : formatDate(record.updatedAt)}</td>
        <td className="module-row-actions">{moduleKey === 'inventory' && record.kind === 'item' && <button className="button button-secondary row-action-button" onClick={() => { setStockItem(record); setStockForm({ direction: 'IN', quantity: '', note: '' }); }}>Adjust</button>}{moduleKey === 'finance' && record.kind === 'invoice' && record.status !== 'PAID' && record.status !== 'CANCELLED' && <button className="button button-secondary row-action-button" onClick={() => { setPaymentInvoice(record); setPaymentForm({ amount: '', description: '' }); }}>Payment</button>}{moduleKey === 'academy' && record.kind === 'submission' && record.status === 'PENDING' && <button className="button button-secondary row-action-button" onClick={() => { setReviewTarget(record); setReviewForm({ decision: 'APPROVED', reviewNote: '' }); }}>Review</button>}{!immutable(record) && <><button className="row-more" onClick={() => openEdit(record)} aria-label={`Edit ${record.title}`}><ArrowUpRight size={14} /></button><button className="row-more" onClick={() => archive(record)} aria-label={`Archive ${record.title}`}><Archive size={14} /></button></>}</td>
      </tr>)}</tbody></TableWrap> : <EmptyState title={`No ${config.title.toLowerCase()} records yet`} text="Create a record to start tracking work in this module." />}
      {meta.pages > 1 && <div className="workspace-pagination"><span>Page {page} of {meta.pages}</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>Previous</button><button className="button button-secondary" disabled={page >= meta.pages} onClick={() => setPage(current => Math.min(meta.pages, current + 1))}>Next</button></div></div>}
    </Panel>

    {editing && <Modal title={editing.isNew ? `Add ${config.title} record` : `Edit ${editing.title}`} onClose={close} size="wide">
      <form className="form-stack" onSubmit={submit}>
        <p className="modal-copy">Keep this record current. Changes are attributed to your account.</p>
        <ErrorBanner>{error}</ErrorBanner>
        <div className="form-grid">
          <label>Record type<select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value })}>{config.kinds.map(kind => <option key={kind} value={kind}>{titleCase(kind)}</option>)}</select></label>
          <label>Status<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{visibleStatuses.filter(status => moduleKey !== 'finance' || form.kind !== 'invoice' || status !== 'PAID' || form.status === 'PAID').map(status => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></label>
          <label className="form-span-two">Title<input autoFocus maxLength="180" required value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
          <label className="form-span-two">Description<textarea maxLength="5000" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
          {moduleKey === 'finance' && form.kind === 'invoice' && !editing.isNew && editing.paymentEntries?.length > 0 && <div className="workspace-history form-span-two"><strong>Payment history</strong>{[...editing.paymentEntries].reverse().map(payment => <div key={payment.id}><span>{formatDate(payment.recordedAt)} · {payment.description || 'Payment received'}</span><b>{payment.currency} {Number(payment.amount).toLocaleString('en-IN')}</b></div>)}</div>}
          {config.fields.map(field => <label key={field}>{titleCase(field)}<input maxLength="5000" value={form.data[field] || ''} onChange={event => updateData(field, event.target.value)} /></label>)}
          {moduleKey === 'inventory' && form.kind === 'item' && <>
            <label>Opening stock<input type="number" min="0" step="1" value={form.stockQuantity} onChange={event => setForm({ ...form, stockQuantity: event.target.value })} disabled={!editing.isNew} /></label>
            <label>Low-stock alert level<input type="number" min="0" step="1" value={form.minStockLevel} onChange={event => setForm({ ...form, minStockLevel: event.target.value })} /></label>
          </>}
          {['projects', 'finance'].includes(moduleKey) && <label>Client<select value={form.client} onChange={event => setForm({ ...form, client: event.target.value })}><option value="">No client linked</option>{clients.map(client => <option key={client._id} value={client._id}>{client.title}</option>)}</select></label>}
          {moduleKey === 'crm' && ['contact', 'deal', 'activity'].includes(form.kind) && <label>Related client<select value={form.client} onChange={event => setForm({ ...form, client: event.target.value })}><option value="">No client linked</option>{clients.map(client => <option key={client._id} value={client._id}>{client.title}</option>)}</select></label>}
          {moduleKey === 'projects' && form.kind === 'task' && <label>Project<select value={form.parent} onChange={event => setForm({ ...form, parent: event.target.value })}><option value="">No project linked</option>{records.filter(record => record.kind === 'project').map(project => <option key={project._id} value={project._id}>{project.title}</option>)}</select></label>}
          {moduleKey === 'academy' && ['enrollment', 'assignment', 'submission', 'certificate'].includes(form.kind) && <label>Student<select value={form.parent} onChange={event => setForm({ ...form, parent: event.target.value })}><option value="">Choose a student</option>{students.map(student => <option key={student._id} value={student._id}>{student.title}</option>)}</select></label>}
          {moduleKey === 'marketing' && form.kind === 'content' && <label>Campaign<select value={form.parent} onChange={event => setForm({ ...form, parent: event.target.value })}><option value="">No campaign linked</option>{records.filter(record => record.kind === 'campaign').map(campaign => <option key={campaign._id} value={campaign._id}>{campaign.title}</option>)}</select></label>}
          {moduleKey === 'support' && form.kind === 'message' && <label>Ticket<select value={form.parent} onChange={event => setForm({ ...form, parent: event.target.value })}><option value="">Choose a ticket</option>{records.filter(record => record.kind === 'ticket').map(ticket => <option key={ticket._id} value={ticket._id}>{ticket.title}</option>)}</select></label>}
          {editing.isNew && ((moduleKey === 'crm' && form.kind === 'client') || (moduleKey === 'academy' && form.kind === 'student')) && <label className="form-span-two">Portal sign-in email<input type="email" autoComplete="email" value={form.portalEmail} onChange={event => setForm({ ...form, portalEmail: event.target.value })} placeholder="Optional — creates a secure portal account" /></label>}
          <label>Assigned staff<select value={form.assignedTo} onChange={event => setForm({ ...form, assignedTo: event.target.value })}><option value="">Unassigned</option>{people.map(person => <option key={person._id} value={person._id}>{person.name} · {person.employeeId || titleCase(person.role)}</option>)}</select></label>
          <label>Due date<input type="date" value={form.dueDate} onChange={event => setForm({ ...form, dueDate: event.target.value })} /></label>
          <label>Amount<input type="number" min="0" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} /></label>
          <label>Currency<input maxLength="3" minLength="3" value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label>
        </div>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={close}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : editing.isNew ? 'Create record' : 'Save changes'}</button></div>
      </form>
    </Modal>}
    {paymentInvoice && <Modal title={`Record payment · ${paymentInvoice.title}`} onClose={() => setPaymentInvoice(null)} size="small">
      <form className="form-stack" onSubmit={recordPayment}><p className="modal-copy">Invoice total {paymentInvoice.currency} {Number(paymentInvoice.amount || 0).toLocaleString('en-IN')} · paid {Number(paymentInvoice.paidAmount || 0).toLocaleString('en-IN')}.</p><ErrorBanner>{error}</ErrorBanner><label>Payment amount ({paymentInvoice.currency})<input type="number" min="0.01" max={Math.max(0, paymentInvoice.amount - (paymentInvoice.paidAmount || 0))} step="0.01" required value={paymentForm.amount} onChange={event => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></label><label>Reference / note<input maxLength="1000" value={paymentForm.description} onChange={event => setPaymentForm({ ...paymentForm, description: event.target.value })} /></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setPaymentInvoice(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Record payment'}</button></div></form>
    </Modal>}
    {stockItem && <Modal title={`Adjust stock · ${stockItem.title}`} onClose={() => setStockItem(null)} size="small">
      <form className="form-stack" onSubmit={adjustStock}><p className="modal-copy">Current stock: {stockItem.stockQuantity ?? 0} · every adjustment is recorded in inventory history.</p>{stockItem.stockMovements?.length > 0 && <div className="workspace-history"><strong>Recent movements</strong>{[...stockItem.stockMovements].reverse().slice(0, 8).map(movement => <div key={movement.id}><span>{formatDate(movement.recordedAt)} · {movement.direction} · {movement.note || 'No note'}</span><b>{movement.direction === 'OUT' ? '−' : '+'}{movement.quantity}</b></div>)}</div>}<ErrorBanner>{error}</ErrorBanner><label>Movement<select value={stockForm.direction} onChange={event => setStockForm({ ...stockForm, direction: event.target.value })}><option value="IN">Receive stock</option><option value="OUT">Issue stock</option></select></label><label>Quantity<input type="number" min="0.01" step="1" required value={stockForm.quantity} onChange={event => setStockForm({ ...stockForm, quantity: event.target.value })} /></label><label>Reference / note<input maxLength="500" value={stockForm.note} onChange={event => setStockForm({ ...stockForm, note: event.target.value })} /></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setStockItem(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save movement'}</button></div></form>
    </Modal>}
    {reviewTarget && <Modal title={`Review · ${reviewTarget.title}`} onClose={() => setReviewTarget(null)} size="small">
      <form className="form-stack" onSubmit={reviewSubmission}><p className="modal-copy">{reviewTarget.description}</p><ErrorBanner>{error}</ErrorBanner><label>Decision<select value={reviewForm.decision} onChange={event => setReviewForm({ ...reviewForm, decision: event.target.value })}><option value="APPROVED">Approve</option><option value="REJECTED">Request changes</option></select></label><label>Feedback<textarea maxLength="1000" value={reviewForm.reviewNote} onChange={event => setReviewForm({ ...reviewForm, reviewNote: event.target.value })} /></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setReviewTarget(null)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save review'}</button></div></form>
    </Modal>}
  </>;
}

export function Reports() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/workspace/reports/overview').then(result => setReport(result.data)).catch(err => setError(err.message)); }, []);
  const totals = (report?.counts || []).reduce((result, row) => {
    result[row.module] = (result[row.module] || 0) + row.count;
    return result;
  }, {});
  return <>
    <PageHeader eyebrow="BUSINESS INTELLIGENCE" title="Reports" description="A current snapshot of records, delivery, and operational follow-ups." />
    <ErrorBanner>{error}</ErrorBanner>
    {report ? <div className="module-report-grid">
      {Object.entries(totals).map(([module, count]) => <div className="module-report-card" key={module}><span>{titleCase(module)}</span><strong>{count}</strong><small>active records</small></div>)}
      <div className="module-report-card module-report-alert"><span>Overdue follow-ups</span><strong>{report.overdue}</strong><small>past due and not resolved</small></div>
    </div> : !error && <Loading label="Preparing reports" />}
    {report && <Panel title="Status breakdown" subtitle={`Generated ${formatDate(report.generatedAt)}`}><div className="module-report-list">{report.counts.map(row => <div key={`${row.module}-${row.status}`}><span>{titleCase(row.module)} · {displayStatus(row.status)}</span><strong>{row.count}</strong></div>)}</div></Panel>}
  </>;
}

export { modules as workspaceModules };
