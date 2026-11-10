import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowUpRight, CalendarDays, Download, History, LayoutDashboard, Link2, Plus, RefreshCw, Search, Settings2, Table2, Upload } from 'lucide-react';
import { API_URL, api, formatDate, titleCase } from '../lib/api.js';
import Modal from '../components/Modal.jsx';
import { EmptyState, ErrorBanner, Loading, PageHeader, Panel, SuccessBanner, TableWrap } from '../components/Primitives.jsx';
import { useAuth } from '../context/AuthContext.jsx';
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
const formatCrmDate = (value, format) => {
  if (!value) return '—';
  const [year, month, day] = new Date(value).toISOString().slice(0, 10).split('-');
  if (format === 'YYYY-MM-DD') return `${year}-${month}-${day}`;
  if (format === 'MM/DD/YYYY') return `${month}/${day}/${year}`;
  return `${day}/${month}/${year}`;
};

export function WorkspaceModule({ moduleKey }) {
  const config = modules[moduleKey];
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [people, setPeople] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [overdueFilter, setOverdueFilter] = useState(false);
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
  const importInput = useRef(null);
  const [crmConfiguration, setCrmConfiguration] = useState(null);
  const [crmConflicts, setCrmConflicts] = useState([]);
  const [crmReport, setCrmReport] = useState(null);
  const [crmReportError, setCrmReportError] = useState('');
  const [timelineTarget, setTimelineTarget] = useState(null);
  const [timelineEntries, setTimelineEntries] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineForm, setTimelineForm] = useState({ type: 'CALL', title: '', description: '', dueDate: '' });
  const [savedViews, setSavedViews] = useState([]);
  const [selectedView, setSelectedView] = useState('');
  const [layout, setLayout] = useState('TABLE');
  const [viewName, setViewName] = useState('');
  const [shareView, setShareView] = useState(false);
  const [showCrmSettings, setShowCrmSettings] = useState(false);
  const [configurationDraft, setConfigurationDraft] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(new Date().toISOString().slice(0, 7));

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ limit: '100' });
      query.set('page', String(page));
      if (search.trim()) query.set('search', search.trim());
      if (filter) query.set('kind', filter);
      if (statusFilter) query.set('status', statusFilter);
      if (assignedFilter) query.set('assignedTo', assignedFilter);
      if (overdueFilter) query.set('overdue', 'true');
      if (moduleKey === 'crm' && selectedView) query.set('view', selectedView);
      const [result, team, crmData] = await Promise.all([
        api(`/workspace/${moduleKey}?${query}`),
        api('/employees?limit=100').catch(() => ({ data: { employees: [] } })),
        moduleKey === 'crm'
          ? Promise.all([
            api('/workspace/crm/config'),
            api('/workspace/crm/views'),
            ['SUPER_ADMIN', 'HR'].includes(user?.role)
              ? api('/workspace/crm/conflicts').catch(() => ({ data: { conflicts: [] } }))
              : Promise.resolve({ data: { conflicts: [] } }),
            api('/workspace/crm/reports').catch(err => ({ error: err.message }))
          ])
          : Promise.resolve(null)
      ]);
      setRecords(result.data.records);
      setMeta(result.meta || { pages: 1, total: result.data.records.length });
      setPeople(team.data.employees);
      if (crmData) {
        setCrmConfiguration(crmData[0].data.configuration);
        setSavedViews(crmData[1].data.views);
        setCrmConflicts(crmData[2].data.conflicts);
        setCrmReport(crmData[3].data || null);
        setCrmReportError(crmData[3].error || '');
      }
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

  useEffect(() => { load(); }, [moduleKey, filter, statusFilter, assignedFilter, overdueFilter, page, selectedView]);
  useEffect(() => {
    setPage(1);
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const openNew = () => {
    const formDefaults = blank(config);
    if (moduleKey === 'crm' && crmConfiguration) {
      formDefaults.kind = crmConfiguration.recordTypes[0];
      formDefaults.status = crmConfiguration.pipelines[formDefaults.kind]?.[0] || formDefaults.status;
      formDefaults.currency = crmConfiguration.currency;
    }
    setForm(formDefaults);
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
  const visibleStatuses = useMemo(
    () => moduleKey === 'crm'
      ? crmConfiguration?.pipelines?.[form.kind] || config.statuses
      : config.statuses,
    [moduleKey, crmConfiguration, form.kind]
  );

  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    const { stockQuantity, minStockLevel, ...formValues } = form;
    const body = {
      ...formValues,
      data: Object.fromEntries(Object.entries(form.data).filter(([, value]) => value.trim())),
      dueDate: form.dueDate || null,
      amount: form.amount === '' ? null : Number(form.amount),
      assignedTo: form.assignedTo || null,
      client: form.client || null,
      parent: form.parent || null,
      portalEmail: form.portalEmail.trim() || undefined,
      ...(moduleKey === 'inventory' && form.kind === 'item' && editing.isNew ? { stockQuantity: Number(stockQuantity), minStockLevel: Number(minStockLevel) } : {}),
      ...(moduleKey === 'inventory' && form.kind === 'item' && !editing.isNew ? { minStockLevel: Number(minStockLevel) } : {})
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

  const exportCrmCsv = async () => {
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`${API_URL}/workspace/crm/export.csv`, { credentials: 'include' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || `Export failed (${response.status})`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'crm-export.csv';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setError(err.message);
    }
  };

  const importCrmCsv = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setError('CSV files must be 1 MB or smaller.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await api('/workspace/crm/import.csv', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: await file.text()
      });
      setSuccess(`Imported ${result.data.imported} CRM records.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveView = async event => {
    event.preventDefault();
    setError('');
    try {
      const result = await api('/workspace/crm/views', {
        method: 'POST',
        body: {
          name: viewName,
          shared: shareView,
          layout,
          filters: { kind: filter, status: statusFilter, assignedTo: assignedFilter, search, overdue: overdueFilter }
        }
      });
      setSavedViews(current => [result.data.view, ...current]);
      setSelectedView(result.data.view._id);
      setViewName('');
      setShareView(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteSelectedView = async () => {
    const view = savedViews.find(item => item._id === selectedView);
    if (!view) return;
    try {
      await api(`/workspace/crm/views/${view._id}`, { method: 'DELETE' });
      setSavedViews(current => current.filter(item => item._id !== view._id));
      setSelectedView('');
    } catch (err) {
      setError(err.message);
    }
  };

  const openCrmSettings = () => {
    setConfigurationDraft({
      ...crmConfiguration,
      pipelines: { ...crmConfiguration.pipelines },
      fields: crmConfiguration.fields.map(field => ({ ...field, options: [...(field.options || [])], kinds: [...(field.kinds || [])] })),
      recordTypes: [...crmConfiguration.recordTypes],
      permissions: { ...crmConfiguration.permissions }
    });
    setShowCrmSettings(true);
  };

  const saveCrmSettings = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await api('/workspace/crm/config', { method: 'PATCH', body: configurationDraft });
      setCrmConfiguration(result.data.configuration);
      setShowCrmSettings(false);
      setSuccess('CRM settings saved.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const moveCrmRecord = async (recordId, status) => {
    try {
      await api(`/workspace/crm/${recordId}`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const connectSalesforce = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await api('/workspace/crm/salesforce/connect', { method: 'POST' });
      window.location.assign(result.data.authorizationUrl);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const runSalesforceSync = async () => {
    setSaving(true);
    setError('');
    try {
      await api('/workspace/crm/salesforce/sync', { method: 'POST' });
      setSuccess('Salesforce sync completed.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resolveConflict = async (conflict, resolution) => {
    setError('');
    try {
      await api(`/workspace/crm/conflicts/${conflict._id}`, { method: 'PATCH', body: { resolution } });
      setCrmConflicts(current => current.filter(item => item._id !== conflict._id));
      setSuccess(`Conflict for ${conflict.record?.title || 'CRM record'} resolved.`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const openTimeline = async record => {
    setTimelineTarget(record);
    setTimelineEntries([]);
    setTimelineLoading(true);
    setTimelineForm({ type: 'CALL', title: '', description: '', dueDate: '' });
    setError('');
    try {
      const result = await api(`/workspace/crm/${record._id}/timeline`);
      setTimelineEntries(result.data.timeline);
    } catch (err) {
      setError(err.message);
    } finally {
      setTimelineLoading(false);
    }
  };

  const addTimelineEntry = async event => {
    event.preventDefault();
    if (!timelineTarget) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api(`/workspace/crm/${timelineTarget._id}/timeline`, {
        method: 'POST',
        body: {
          ...timelineForm,
          dueDate: timelineForm.type === 'TASK' ? timelineForm.dueDate || null : undefined
        }
      });
      const result = await api(`/workspace/crm/${timelineTarget._id}/timeline`);
      setTimelineEntries(result.data.timeline);
      setTimelineForm({ type: 'CALL', title: '', description: '', dueDate: '' });
      setSuccess('Timeline entry added.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const stockTone = record => record.stockQuantity === 0 ? 'OUT_OF_STOCK' : record.stockQuantity <= record.minStockLevel ? 'LOW_STOCK' : 'IN_STOCK';
  const immutable = record => record.kind === 'movement' || record.kind === 'payment' || record.kind === 'submission';
  const canImportCrm = user?.role === 'SUPER_ADMIN'
    || (user?.role === 'HR' && (!Array.isArray(user.workspacePermissions) || user.workspacePermissions.includes('crm')))
    || (user?.role === 'EMPLOYEE' && (user.workspacePermissions || ['projects', 'support']).includes('crm'));
  const crmStages = filter
    ? crmConfiguration?.pipelines?.[filter] || []
    : [...new Set(Object.values(crmConfiguration?.pipelines || {}).flat())];
  const displayedRecords = layout === 'CALENDAR'
    ? records.filter(record => record.dueDate?.slice(0, 7) === calendarMonth)
    : records;
  const reportStages = crmReport?.pipeline || [];
  const stagesByKind = ['lead', 'deal'].map(kind => ({
    kind,
    stages: reportStages.filter(stage => stage._id.kind === kind)
  }));
  return <>
    <PageHeader eyebrow={config.eyebrow} title={config.title} description={config.description} action={<div className="workspace-header-actions">{moduleKey === 'crm' && <>
      <button className="button button-secondary" onClick={exportCrmCsv}><Download size={16} /> Export CSV</button>
      {canImportCrm && <button className="button button-secondary" onClick={() => importInput.current?.click()} disabled={saving}><Upload size={16} /> Import CSV</button>}
      {['SUPER_ADMIN', 'HR'].includes(user?.role) && <button className="button button-secondary" onClick={openCrmSettings}><Settings2 size={16} /> CRM settings</button>}
      <input ref={importInput} type="file" accept=".csv,text/csv" onChange={importCrmCsv} hidden />
    </>}<button className="button button-primary" onClick={openNew}><Plus size={16} /> Add record</button></div>} />
    {moduleKey === 'crm' && <section className="crm-report-section" aria-label="Sales overview">
      {crmReportError && <ErrorBanner>{crmReportError}</ErrorBanner>}
      {crmReport && <>
        <div className="module-report-grid">
          <div className="module-report-card"><span>Leads</span><strong>{crmReport.summary.leads}</strong><small>{crmReport.summary.qualifiedLeads} qualified</small></div>
          <div className="module-report-card"><span>Open deals</span><strong>{crmReport.summary.openDeals}</strong><small>{crmReport.summary.deals} total deals</small></div>
          <div className="module-report-card"><span>Won revenue</span><strong>{crmConfiguration?.currency || 'INR'} {Number(crmReport.summary.wonRevenue).toLocaleString('en-IN')}</strong><small>{crmReport.summary.wonDeals} won deals</small></div>
          <div className="module-report-card"><span>Deal win rate</span><strong>{crmReport.summary.conversionRate}%</strong><small>won deals ÷ all deals</small></div>
          <div className="module-report-card module-report-alert"><span>Overdue follow-ups</span><strong>{crmReport.summary.overdue}</strong><small>open tasks past their due date</small></div>
        </div>
        <div className="crm-report-columns">
          {stagesByKind.map(({ kind, stages }) => <Panel key={kind} title={`${titleCase(kind)} pipeline`} subtitle="Records by current stage">
            {stages.length ? <div className="module-report-list">{stages.map(stage => <div key={stage._id.status}><span>{displayStatus(stage._id.status)}</span><strong>{stage.count}</strong></div>)}</div> : <p className="crm-report-empty">No {kind} records yet.</p>}
          </Panel>)}
          <Panel title="Lead sources" subtitle="Top sources by lead count">
            {crmReport.leadSources.length ? <div className="module-report-list">{crmReport.leadSources.map(source => <div key={source._id}><span>{source._id}</span><strong>{source.count}</strong></div>)}</div> : <p className="crm-report-empty">Add a lead source to see this breakdown.</p>}
          </Panel>
          <Panel title="Owner performance" subtitle="Won deals and revenue">
            {crmReport.owners.length ? <div className="module-report-list">{crmReport.owners.map(owner => <div key={owner.ownerId || owner.ownerName}><span>{owner.ownerName} · {owner.wonDeals} won</span><strong>{crmConfiguration?.currency || 'INR'} {Number(owner.wonRevenue).toLocaleString('en-IN')}</strong></div>)}</div> : <p className="crm-report-empty">No assigned leads or deals yet.</p>}
          </Panel>
        </div>
      </>}
    </section>}
    <Panel title="Workspace records" subtitle={`${meta.total} active records · changes are recorded in the audit history`} action={<div className="crm-toolbar">
      {moduleKey === 'crm' && <div className="crm-view-tools">
        <select className="filter-select" value={selectedView} onChange={event => {
          const next = savedViews.find(view => view._id === event.target.value);
          setSelectedView(event.target.value);
          if (next) {
            setLayout(next.layout);
            setFilter(next.filters.kind);
            setStatusFilter(next.filters.status);
            setAssignedFilter(next.filters.assignedTo);
            setSearch(next.filters.search || '');
            setOverdueFilter(next.filters.overdue);
          }
        }}><option value="">Current view</option>{savedViews.map(view => <option key={view._id} value={view._id}>{view.name}{view.shared ? ' · team' : ' · private'}</option>)}</select>
        <div className="crm-layout-switch">
          {[['TABLE', Table2, 'Table'], ['KANBAN', LayoutDashboard, 'Kanban'], ['CALENDAR', CalendarDays, 'Calendar']].map(([value, Icon, label]) => <button type="button" key={value} className={`button ${layout === value ? 'button-primary' : 'button-secondary'}`} onClick={() => { setLayout(value); setSelectedView(''); }}><Icon size={14} />{label}</button>)}
        </div>
        <form className="crm-save-view" onSubmit={saveView}><input aria-label="Saved view name" placeholder="View name" value={viewName} onChange={event => setViewName(event.target.value)} required maxLength="80" /><label><input type="checkbox" checked={shareView} onChange={event => setShareView(event.target.checked)} /> Share</label><button className="button button-secondary">Save view</button>{savedViews.some(view => view._id === selectedView && String(view.owner) === String(user?._id)) && <button type="button" className="button button-secondary" onClick={deleteSelectedView}>Delete view</button>}</form>
      </div>}
      <div className="panel-filters"><label className="module-search"><Search size={14} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search records" /></label>
        <select className="filter-select" value={filter} onChange={event => { setPage(1); setFilter(event.target.value); setStatusFilter(''); setSelectedView(''); }}><option value="">All types</option>{(moduleKey === 'crm' ? crmConfiguration?.recordTypes || config.kinds : config.kinds).map(kind => <option key={kind} value={kind}>{titleCase(kind)}</option>)}</select>
        <select className="filter-select" value={statusFilter} onChange={event => { setPage(1); setStatusFilter(event.target.value); setSelectedView(''); }}><option value="">All stages</option>{(moduleKey === 'crm' ? crmStages : config.statuses).map(status => <option key={status} value={status}>{displayStatus(status)}</option>)}</select>
        {moduleKey === 'crm' && <><select className="filter-select" value={assignedFilter} onChange={event => { setAssignedFilter(event.target.value); setSelectedView(''); }}><option value="">All owners</option><option value="me">My records</option>{people.map(person => <option key={person._id} value={person._id}>{person.name}</option>)}</select><label className="crm-overdue-filter"><input type="checkbox" checked={overdueFilter} onChange={event => { setOverdueFilter(event.target.checked); setSelectedView(''); }} /> Overdue</label></>}
      </div>
    </div>}>
      <ErrorBanner>{error}</ErrorBanner><SuccessBanner>{success}{temporaryPassword && <div className="portal-credential"><span>ONE-TIME PORTAL PASSWORD</span><code>{temporaryPassword}</code><small>Share it securely. The person will be required to set a new password at first sign-in.</small></div>}</SuccessBanner>
      {moduleKey === 'crm' && layout === 'CALENDAR' && <label className="crm-month-filter">Follow-up month<input type="month" value={calendarMonth} onChange={event => setCalendarMonth(event.target.value)} /></label>}
      {loading ? <Loading label={`Loading ${config.title.toLowerCase()}`} /> : displayedRecords.length ? moduleKey === 'crm' && layout === 'KANBAN' ? <div className="crm-kanban">{crmStages.map(stage => <section key={stage} className="crm-kanban-column" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); if (id) moveCrmRecord(id, stage); }}><header><strong>{displayStatus(stage)}</strong><span>{records.filter(record => record.status === stage).length}</span></header>{records.filter(record => record.status === stage).map(record => <button key={record._id} draggable className="crm-kanban-card" onClick={() => openEdit(record)} onDragStart={event => event.dataTransfer.setData('text/plain', record._id)}><strong>{record.title}</strong><span>{record.data?.company || record.data?.contactName || record.kind}</span><small>{record.assignedTo?.name || 'Unassigned'} · score {record.score ?? 0}</small></button>)}</section>)}</div> : moduleKey === 'crm' && layout === 'CALENDAR' ? <div className="crm-calendar">{displayedRecords.filter(record => record.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(record => <button key={record._id} className="crm-calendar-item" onClick={() => openEdit(record)}><time>{formatCrmDate(record.dueDate, crmConfiguration?.dateFormat)}</time><strong>{record.title}</strong><span>{titleCase(record.kind)} · {record.assignedTo?.name || 'Unassigned'}</span></button>)}</div> : <TableWrap><thead><tr><th>Record</th><th>Type</th><th>Status</th>{moduleKey === 'inventory' && <th>Stock</th>}<th>Owner</th><th>Due</th><th>{moduleKey === 'finance' ? 'Balance' : 'Updated'}</th><th /></tr></thead><tbody>{displayedRecords.map(record => <tr key={record._id}>
        <td><button className="person-cell person-button" onClick={() => openEdit(record)}><span className="person-lines"><strong>{record.title}</strong><small>{record.description || record.data?.company || record.data?.reference || 'Open record'}</small></span></button></td>
        <td>{titleCase(record.kind)}</td><td><span className="role-label">{displayStatus(moduleKey === 'inventory' && record.kind === 'item' ? stockTone(record) : record.status)}</span></td>
        {moduleKey === 'inventory' && <td>{record.kind === 'item' ? `${record.stockQuantity ?? 0} ${record.data?.unit || 'units'} · min ${record.minStockLevel ?? 0}` : record.quantity ? `${record.data?.direction || ''} ${record.quantity}` : '—'}</td>}
        <td>{record.assignedTo?.name || record.createdBy?.name || '—'}</td><td>{moduleKey === 'crm' ? formatCrmDate(record.dueDate, crmConfiguration?.dateFormat) : formatDate(record.dueDate)}</td>
        <td>{moduleKey === 'finance' && record.kind === 'invoice' ? `${record.currency || 'INR'} ${(Math.max(0, (record.amount || 0) - (record.paidAmount || 0))).toLocaleString('en-IN')} due` : record.amount !== null && record.amount !== undefined ? `${record.currency || 'INR'} ${Number(record.amount).toLocaleString('en-IN')}` : moduleKey === 'crm' ? formatCrmDate(record.updatedAt, crmConfiguration?.dateFormat) : formatDate(record.updatedAt)}</td>
        <td className="module-row-actions">{moduleKey === 'crm' && ['lead', 'client', 'contact', 'deal'].includes(record.kind) && <button className="row-more" onClick={() => openTimeline(record)} aria-label={`Open timeline for ${record.title}`} title="Timeline"><History size={14} /></button>}{moduleKey === 'inventory' && record.kind === 'item' && <button className="button button-secondary row-action-button" onClick={() => { setStockItem(record); setStockForm({ direction: 'IN', quantity: '', note: '' }); }}>Adjust</button>}{moduleKey === 'finance' && record.kind === 'invoice' && record.status !== 'PAID' && record.status !== 'CANCELLED' && <button className="button button-secondary row-action-button" onClick={() => { setPaymentInvoice(record); setPaymentForm({ amount: '', description: '' }); }}>Payment</button>}{moduleKey === 'academy' && record.kind === 'submission' && record.status === 'PENDING' && <button className="button button-secondary row-action-button" onClick={() => { setReviewTarget(record); setReviewForm({ decision: 'APPROVED', reviewNote: '' }); }}>Review</button>}{!immutable(record) && <><button className="row-more" onClick={() => openEdit(record)} aria-label={`Edit ${record.title}`}><ArrowUpRight size={14} /></button><button className="row-more" onClick={() => archive(record)} aria-label={`Archive ${record.title}`}><Archive size={14} /></button></>}</td>
      </tr>)}</tbody></TableWrap> : <EmptyState title={`No ${config.title.toLowerCase()} records yet`} text="Create a record to start tracking work in this module." />}
      {meta.pages > 1 && <div className="workspace-pagination"><span>Page {page} of {meta.pages}</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>Previous</button><button className="button button-secondary" disabled={page >= meta.pages} onClick={() => setPage(current => Math.min(meta.pages, current + 1))}>Next</button></div></div>}
    </Panel>

    {moduleKey === 'crm' && crmConflicts.length > 0 && <Panel title="Salesforce sync conflicts" subtitle="Both systems changed these records. Choose which version to keep."><div className="crm-conflict-list">{crmConflicts.map(conflict => <div key={conflict._id}><span><strong>{conflict.record?.title || 'CRM record'}</strong><small>{conflict.salesforceType} · {formatCrmDate(conflict.updatedAt, crmConfiguration?.dateFormat)}</small></span><div><button className="button button-secondary" onClick={() => resolveConflict(conflict, 'LOCAL')}>Keep VandeOS</button><button className="button button-primary" onClick={() => resolveConflict(conflict, 'SALESFORCE')}>Keep Salesforce</button></div></div>)}</div></Panel>}

    {timelineTarget && <Modal title={`Timeline · ${timelineTarget.title}`} onClose={() => setTimelineTarget(null)} size="wide">
      <div className="crm-timeline">
        <ErrorBanner>{error}</ErrorBanner>
        <form className="form-stack crm-timeline-form" onSubmit={addTimelineEntry}>
          <strong>Log an interaction or follow-up</strong>
          <div className="crm-timeline-fields">
            <label>Type<select value={timelineForm.type} onChange={event => setTimelineForm({ ...timelineForm, type: event.target.value })}><option value="CALL">Call</option><option value="EMAIL">Email</option><option value="MEETING">Meeting</option><option value="NOTE">Note</option><option value="TASK">Follow-up task</option></select></label>
            <label>Title<input required minLength="2" maxLength="180" value={timelineForm.title} onChange={event => setTimelineForm({ ...timelineForm, title: event.target.value })} /></label>
            {timelineForm.type === 'TASK' && <label>Due date<input type="date" value={timelineForm.dueDate} onChange={event => setTimelineForm({ ...timelineForm, dueDate: event.target.value })} /></label>}
            <label className="crm-timeline-description">Notes<textarea maxLength="5000" value={timelineForm.description} onChange={event => setTimelineForm({ ...timelineForm, description: event.target.value })} /></label>
          </div>
          <div className="modal-actions"><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Add to timeline'}</button></div>
        </form>
        <section className="crm-timeline-list" aria-label="Interaction history">
          <h3>Recent activity</h3>
          {timelineLoading ? <Loading label="Loading timeline" /> : timelineEntries.length ? timelineEntries.map(entry => <article key={entry._id}>
            <span className="crm-timeline-type">{titleCase(entry.data?.interactionType || 'activity')}</span>
            <div><strong>{entry.title}</strong>{entry.description && <p>{entry.description}</p>}<small>{formatDate(entry.data?.occurredAt || entry.createdAt)} · {entry.createdBy?.name || 'Team member'}{entry.dueDate ? ` · Due ${formatCrmDate(entry.dueDate, crmConfiguration?.dateFormat)}` : ''}{entry.status === 'DONE' ? ' · Completed' : ''}</small></div>
          </article>) : <EmptyState title="No activity yet" text="Calls, emails, meetings, notes, and follow-up tasks will appear here." />}
        </section>
      </div>
    </Modal>}
    {editing && <Modal title={editing.isNew ? `Add ${config.title} record` : `Edit ${editing.title}`} onClose={close} size="wide">
      <form className="form-stack" onSubmit={submit}>
        <p className="modal-copy">Keep this record current. Changes are attributed to your account.</p>
        <ErrorBanner>{error}</ErrorBanner>
        <div className="form-grid">
          <label>Record type<select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value, status: (moduleKey === 'crm' ? crmConfiguration?.pipelines?.[event.target.value] : null)?.[0] || config.statuses[0] })}>{(moduleKey === 'crm' ? crmConfiguration?.recordTypes || config.kinds : config.kinds).map(kind => <option key={kind} value={kind}>{titleCase(kind)}</option>)}</select></label>
          <label>Status<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}>{visibleStatuses.filter(status => moduleKey !== 'finance' || form.kind !== 'invoice' || status !== 'PAID' || form.status === 'PAID').map(status => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></label>
          <label className="form-span-two">Title<input autoFocus maxLength="180" required value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} /></label>
          <label className="form-span-two">Description<textarea maxLength="5000" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
          {moduleKey === 'finance' && form.kind === 'invoice' && !editing.isNew && editing.paymentEntries?.length > 0 && <div className="workspace-history form-span-two"><strong>Payment history</strong>{[...editing.paymentEntries].reverse().map(payment => <div key={payment.id}><span>{formatDate(payment.recordedAt)} · {payment.description || 'Payment received'}</span><b>{payment.currency} {Number(payment.amount).toLocaleString('en-IN')}</b></div>)}</div>}
          {(moduleKey === 'crm' ? (crmConfiguration?.fields || []).filter(field => !field.kinds?.length || field.kinds.includes(form.kind)) : config.fields.map(key => ({ key, label: titleCase(key), type: 'TEXT' }))).map(field => <label key={field.key}>{field.label}{field.type === 'SELECT' ? <select required={field.required} value={form.data[field.key] || ''} onChange={event => updateData(field.key, event.target.value)}><option value="">Choose…</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select> : <input type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'} maxLength={field.type === 'TEXT' ? '5000' : undefined} required={field.required} value={form.data[field.key] || ''} onChange={event => updateData(field.key, event.target.value)} />}</label>)}
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
    {showCrmSettings && configurationDraft && <Modal title="CRM business settings" onClose={() => setShowCrmSettings(false)} size="wide">
      <form className="form-stack crm-settings-form" onSubmit={saveCrmSettings}>
        <p className="modal-copy">Customize stages, record types, fields, access and lead scoring for your organization.</p>
        <ErrorBanner>{error}</ErrorBanner>
        <div className="form-grid">
          <label>Business currency<input maxLength="3" value={configurationDraft.currency} onChange={event => setConfigurationDraft({ ...configurationDraft, currency: event.target.value.toUpperCase() })} /></label>
          <label>Date format<select value={configurationDraft.dateFormat} onChange={event => setConfigurationDraft({ ...configurationDraft, dateFormat: event.target.value })}><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option><option value="MM/DD/YYYY">MM/DD/YYYY</option></select></label>
          <label className="form-span-two">Record types (comma-separated)<input value={configurationDraft.recordTypes.join(', ')} onChange={event => setConfigurationDraft({ ...configurationDraft, recordTypes: event.target.value.split(',').map(kind => kind.trim().toLowerCase()).filter(Boolean) })} /></label>
          {configurationDraft.recordTypes.map(kind => <label key={kind}>{titleCase(kind)} stages (one per line)<textarea value={(configurationDraft.pipelines[kind] || []).join('\n')} onChange={event => setConfigurationDraft({ ...configurationDraft, pipelines: { ...configurationDraft.pipelines, [kind]: event.target.value.split('\n').map(stage => stage.trim().toUpperCase()).filter(Boolean) } })} /></label>)}
          <section className="form-span-two crm-settings-section"><h3>Custom fields</h3>{configurationDraft.fields.map((field, index) => <div className="crm-config-field" key={field.key}><label>Label<input value={field.label} onChange={event => setConfigurationDraft({ ...configurationDraft, fields: configurationDraft.fields.map((item, current) => current === index ? { ...item, label: event.target.value } : item) })} /></label><label>Type<select value={field.type} onChange={event => setConfigurationDraft({ ...configurationDraft, fields: configurationDraft.fields.map((item, current) => current === index ? { ...item, type: event.target.value } : item) })}><option value="TEXT">Text</option><option value="NUMBER">Number</option><option value="DATE">Date</option><option value="SELECT">Dropdown</option></select></label>{field.type === 'SELECT' && <label>Options<input value={field.options.join(', ')} onChange={event => setConfigurationDraft({ ...configurationDraft, fields: configurationDraft.fields.map((item, current) => current === index ? { ...item, options: event.target.value.split(',').map(option => option.trim()).filter(Boolean) } : item) })} /></label>}<label>Record types<input placeholder="All types or comma-separated" value={field.kinds.join(', ')} onChange={event => setConfigurationDraft({ ...configurationDraft, fields: configurationDraft.fields.map((item, current) => current === index ? { ...item, kinds: event.target.value.split(',').map(kind => kind.trim()).filter(Boolean) } : item) })} /></label><label className="checkbox-field"><input type="checkbox" checked={field.required} onChange={event => setConfigurationDraft({ ...configurationDraft, fields: configurationDraft.fields.map((item, current) => current === index ? { ...item, required: event.target.checked } : item) })} /><span><strong>Required</strong></span></label><button type="button" className="button button-secondary" onClick={() => setConfigurationDraft({ ...configurationDraft, fields: configurationDraft.fields.filter((_, current) => current !== index) })}>Remove</button></div>)}<button type="button" className="button button-secondary" onClick={() => setConfigurationDraft({ ...configurationDraft, fields: [...configurationDraft.fields, { key: `customField${configurationDraft.fields.length + 1}`, label: 'New field', type: 'TEXT', options: [], required: false, kinds: [] }] })}>Add custom field</button></section>
          <section className="form-span-two crm-settings-section"><h3>Lead scoring rules</h3>{configurationDraft.scoringRules.map((rule, index) => <div className="crm-config-field" key={`${rule.field}-${index}`}><label>Field<input value={rule.field} onChange={event => setConfigurationDraft({ ...configurationDraft, scoringRules: configurationDraft.scoringRules.map((item, current) => current === index ? { ...item, field: event.target.value } : item) })} /></label><label>Match<select value={rule.operator} onChange={event => setConfigurationDraft({ ...configurationDraft, scoringRules: configurationDraft.scoringRules.map((item, current) => current === index ? { ...item, operator: event.target.value } : item) })}><option value="present">Has value</option><option value="equals">Equals</option><option value="contains">Contains</option></select></label><label>Value<input value={rule.value} onChange={event => setConfigurationDraft({ ...configurationDraft, scoringRules: configurationDraft.scoringRules.map((item, current) => current === index ? { ...item, value: event.target.value } : item) })} /></label><label>Points<input type="number" min="0" max="100" value={rule.points} onChange={event => setConfigurationDraft({ ...configurationDraft, scoringRules: configurationDraft.scoringRules.map((item, current) => current === index ? { ...item, points: Number(event.target.value) } : item) })} /></label><button type="button" className="button button-secondary" onClick={() => setConfigurationDraft({ ...configurationDraft, scoringRules: configurationDraft.scoringRules.filter((_, current) => current !== index) })}>Remove</button></div>)}<button type="button" className="button button-secondary" onClick={() => setConfigurationDraft({ ...configurationDraft, scoringRules: [...configurationDraft.scoringRules, { field: 'source', operator: 'present', value: '', points: 10 }] })}>Add scoring rule</button></section>
          <section className="form-span-two crm-settings-section"><h3>Role permissions</h3>{Object.entries(configurationDraft.permissions).map(([role, permissions]) => <div className="crm-role-permissions" key={role}><strong>{titleCase(role)}</strong>{['view', 'edit', 'export', 'assign'].map(permission => <label key={permission}><input type="checkbox" checked={permissions[permission]} onChange={event => setConfigurationDraft({ ...configurationDraft, permissions: { ...configurationDraft.permissions, [role]: { ...permissions, [permission]: event.target.checked } } })} />{titleCase(permission)}</label>)}</div>)}</section>
          <section className="form-span-two crm-settings-section"><h3>Templates</h3>{configurationDraft.emailTemplates.map((template, index) => <div className="crm-template" key={`${template.name}-${index}`}><label>Name<input value={template.name} onChange={event => setConfigurationDraft({ ...configurationDraft, emailTemplates: configurationDraft.emailTemplates.map((item, current) => current === index ? { ...item, name: event.target.value } : item) })} /></label><label>Type<select value={template.kind} onChange={event => setConfigurationDraft({ ...configurationDraft, emailTemplates: configurationDraft.emailTemplates.map((item, current) => current === index ? { ...item, kind: event.target.value } : item) })}><option value="EMAIL">Email</option><option value="ACTIVITY">Activity</option></select></label>{template.kind === 'EMAIL' && <label>Subject<input value={template.subject} onChange={event => setConfigurationDraft({ ...configurationDraft, emailTemplates: configurationDraft.emailTemplates.map((item, current) => current === index ? { ...item, subject: event.target.value } : item) })} /></label>}<label className="form-span-two">Body<textarea value={template.body} onChange={event => setConfigurationDraft({ ...configurationDraft, emailTemplates: configurationDraft.emailTemplates.map((item, current) => current === index ? { ...item, body: event.target.value } : item) })} /></label><button type="button" className="button button-secondary" onClick={() => setConfigurationDraft({ ...configurationDraft, emailTemplates: configurationDraft.emailTemplates.filter((_, current) => current !== index) })}>Remove</button></div>)}<button type="button" className="button button-secondary" onClick={() => setConfigurationDraft({ ...configurationDraft, emailTemplates: [...configurationDraft.emailTemplates, { name: 'Follow-up', subject: 'Following up', body: 'Hello {{contactName}},\\n\\nFollowing up about {{title}}.', kind: 'EMAIL' }] })}>Add template</button></section>
          <section className="form-span-two crm-settings-section"><h3>Automations</h3>{configurationDraft.automations.map((automation, index) => <div className="crm-config-field" key={`${automation.name}-${index}`}><label>Name<input value={automation.name} onChange={event => setConfigurationDraft({ ...configurationDraft, automations: configurationDraft.automations.map((item, current) => current === index ? { ...item, name: event.target.value } : item) })} /></label><label>Trigger<select value={automation.trigger} onChange={event => setConfigurationDraft({ ...configurationDraft, automations: configurationDraft.automations.map((item, current) => current === index ? { ...item, trigger: event.target.value } : item) })}><option value="FOLLOW_UP_DUE">Follow-up due</option><option value="STAGE_CHANGED">Stage changed (create activity)</option></select></label><label>Stage (optional)<input value={automation.stage} onChange={event => setConfigurationDraft({ ...configurationDraft, automations: configurationDraft.automations.map((item, current) => current === index ? { ...item, stage: event.target.value } : item) })} /></label><label>Template (optional)<select value={automation.templateName} onChange={event => setConfigurationDraft({ ...configurationDraft, automations: configurationDraft.automations.map((item, current) => current === index ? { ...item, templateName: event.target.value } : item) })}><option value="">None</option>{configurationDraft.emailTemplates.map(template => <option key={template.name} value={template.name}>{template.name}</option>)}</select></label><label>Delay days<input type="number" min="0" max="365" value={automation.delayDays ?? 1} onChange={event => setConfigurationDraft({ ...configurationDraft, automations: configurationDraft.automations.map((item, current) => current === index ? { ...item, delayDays: Number(event.target.value) } : item) })} /></label><label className="checkbox-field"><input type="checkbox" checked={automation.enabled} onChange={event => setConfigurationDraft({ ...configurationDraft, automations: configurationDraft.automations.map((item, current) => current === index ? { ...item, enabled: event.target.checked } : item) })} /><span><strong>Enabled</strong></span></label><button type="button" className="button button-secondary" onClick={() => setConfigurationDraft({ ...configurationDraft, automations: configurationDraft.automations.filter((_, current) => current !== index) })}>Remove</button></div>)}<button type="button" className="button button-secondary" onClick={() => setConfigurationDraft({ ...configurationDraft, automations: [...configurationDraft.automations, { name: 'Follow-up reminder', trigger: 'FOLLOW_UP_DUE', enabled: true, stage: '', templateName: '', delayDays: 1 }] })}>Add automation</button></section>
          {user?.role === 'SUPER_ADMIN' && <section className="form-span-two crm-settings-section"><h3>Salesforce</h3><p className="settings-help">{configurationDraft.salesforce.connected ? `Connected${configurationDraft.salesforce.lastSyncAt ? ` · last sync ${formatCrmDate(configurationDraft.salesforce.lastSyncAt, configurationDraft.dateFormat)}` : ''}` : 'Connect a Salesforce organization for automatic two-way sync every five minutes. Conflicts are held for review.'}</p>{configurationDraft.salesforce.lastSyncError && <ErrorBanner>{configurationDraft.salesforce.lastSyncError}</ErrorBanner>}<div className="crm-integration-actions">{configurationDraft.salesforce.connected ? <><button type="button" className="button button-secondary" disabled={saving} onClick={runSalesforceSync}><RefreshCw size={14} /> Sync now</button><button type="button" className="button button-secondary" disabled={saving} onClick={async () => { try { await api('/workspace/crm/salesforce/connect', { method: 'DELETE' }); await load(); setSuccess('Salesforce disconnected.'); } catch (err) { setError(err.message); } }}>Disconnect</button></> : <button type="button" className="button button-secondary" disabled={saving} onClick={connectSalesforce}><Link2 size={14} /> Connect Salesforce</button>}</div></section>}
        </div>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setShowCrmSettings(false)}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save CRM settings'}</button></div>
      </form>
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
