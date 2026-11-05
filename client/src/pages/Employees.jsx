import { Plus, Search, UserRoundPlus, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, formatDate, initials, titleCase } from '../lib/api.js';
import { Badge, EmptyState, ErrorBanner, Loading, PageHeader, Panel, SearchField, StatusBadge, SuccessBanner, TableWrap } from '../components/Primitives.jsx';
import Modal from '../components/Modal.jsx';

const employeeWorkspaceModules = ['crm', 'projects', 'academy', 'marketing', 'inventory', 'support'];
const hrWorkspaceModules = [...employeeWorkspaceModules, 'reports'];
const blank = { name: '', email: '', title: '', phone: '', division: '', department: '', shift: '', role: 'EMPLOYEE', workspacePermissions: ['projects', 'support'], employmentType: 'FULL_TIME', remoteApproved: false };

export default function Employees() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');

  const load = async () => {
    setBusy(true); setError('');
    try {
      const query = new URLSearchParams({ status: filter, limit: '100' });
      if (search.trim()) query.set('search', search.trim());
      const [people, depts, divs, shiftList] = await Promise.all([api(`/employees?${query}`), api('/departments'), api('/divisions'), api('/shifts')]);
      setEmployees(people.data.employees); setDepartments(depts.data.departments); setDivisions(divs.data.divisions); setShifts(shiftList.data.shifts);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [filter]);
  useEffect(() => { const timer = setTimeout(load, 240); return () => clearTimeout(timer); }, [search]);

  const openCreate = () => { setEditing(null); setCreating(true); setForm({ ...blank, division: divisions[0]?._id || '', department: departments.find(item => item.division?._id === divisions[0]?._id)?._id || '', shift: shifts[0]?._id || '' }); setTemporaryPassword(''); setError(''); setSuccess(''); };
  const defaultPermissions = role => role === 'HR' ? hrWorkspaceModules : role === 'EMPLOYEE' ? ['projects', 'support'] : [];
  const openEdit = employee => { setCreating(false); setEditing(employee); setForm({ name: employee.name, email: employee.email, title: employee.title || '', phone: employee.phone || '', division: employee.division?._id || '', department: employee.department?._id || '', shift: employee.shift?._id || '', role: employee.role, workspacePermissions: employee.workspacePermissions ?? defaultPermissions(employee.role), employmentType: employee.employmentType, remoteApproved: employee.remoteApproved, active: employee.active }); setTemporaryPassword(''); setError(''); setSuccess(''); };

  const availableDepartments = useMemo(() => departments.filter(item => item.active && item.division?._id === form.division), [departments, form.division]);
  const submit = async event => {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    try {
      if (editing) {
        const { email: _email, ...update } = form;
        if (user.role !== 'SUPER_ADMIN') delete update.role;
        if (editing.active !== undefined) update.active = editing.active;
        if (!['EMPLOYEE', 'HR'].includes(form.role)) delete update.workspacePermissions;
        const result = await api(`/employees/${editing._id}`, { method: 'PATCH', body: update });
        setSuccess(`${result.data.employee.name}’s profile has been updated.`); setEditing(null);
      } else {
        const body = form;
        const result = await api('/employees', { method: 'POST', body });
        setTemporaryPassword(result.data.temporaryPassword); setSuccess(`${result.data.employee.name} has been added.`);
        setCreating(false); setEditing({ ...result.data.employee, _created: true });
      }
      await load();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const deactivate = async employee => {
    if (!window.confirm(`Deactivate ${employee.name}’s account? They will no longer be able to sign in.`)) return;
    try { await api(`/employees/${employee._id}/deactivate`, { method: 'POST' }); setSuccess(`${employee.name} has been deactivated.`); await load(); }
    catch (err) { setError(err.message); }
  };

  const closeModal = () => { setEditing(null); setCreating(false); setTemporaryPassword(''); setError(''); setSuccess(''); };
  return <>
    <PageHeader eyebrow="YOUR TEAM" title="People" description="The people behind everything Vande does." action={<button className="button button-primary" onClick={openCreate}><Plus size={17} /> Add a person</button>} />
    <div className="employee-summary"><div className="employee-summary-icon"><Users size={18} /></div><div><strong>{employees.length}</strong><span>{filter === 'active' ? 'people shown' : 'inactive accounts'}{employees.length === 100 ? ' · Showing first 100' : ''}</span></div><span className="summary-divider" /><div className="employee-summary-detail"><span>Departments</span><strong>{departments.filter(item => item.active).length}</strong></div><div className="employee-summary-detail"><span>Remote approved</span><strong>{employees.filter(item => item.remoteApproved).length}</strong></div><div className="summary-dot">•</div><span className="summary-live">Team at a glance</span></div>
    <Panel className="people-panel" title="Team directory" subtitle="Search and manage your Vande team" action={<div className="panel-filters"><SearchField value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people" /><select className="filter-select" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Active people</option><option value="inactive">Inactive people</option></select></div>}>
      <ErrorBanner>{error}</ErrorBanner><SuccessBanner>{success}</SuccessBanner>
      {busy ? <Loading label="Loading people" /> : employees.length ? <TableWrap><thead><tr><th>Person</th><th>Role</th><th>Department</th><th>Shift</th><th>Work mode</th><th>Joined</th><th /></tr></thead><tbody>{employees.map(employee => <tr key={employee._id}><td><button className="person-cell person-button" onClick={() => openEdit(employee)}><span className={`avatar avatar-small avatar-tone-${employee.name.length % 5}`}>{initials(employee.name)}</span><span className="person-lines"><strong>{employee.name}</strong><small>{employee.employeeId || employee.email}</small></span></button></td><td><span className="role-label">{employee.role === 'SUPER_ADMIN' ? 'Super Admin' : titleCase(employee.role)}</span></td><td><span className="department-cell">{employee.department?.name || '—'}</span><small className="division-sub">{employee.division?.name || ''}</small></td><td>{employee.shift?.name || <span className="muted">Unassigned</span>}</td><td>{employee.remoteApproved ? <Badge tone="purple">Remote approved</Badge> : <Badge tone="blue">Office · GPS</Badge>}</td><td>{formatDate(employee.joinedAt)}</td><td><button className="row-more" onClick={() => openEdit(employee)} aria-label={`Edit ${employee.name}`}>•••</button></td></tr>)}</tbody></TableWrap> : <EmptyState title={filter === 'active' ? 'Your team is ready for its first member' : 'No inactive accounts'} text={filter === 'active' ? 'Add an employee to begin setting up your Vande workspace.' : 'Deactivated people will appear here.'} />}
      <div className="table-footer"><span>Showing <strong>{employees.length}</strong> {filter === 'active' ? 'active' : 'inactive'} team members</span><span>Directory updated just now</span></div>
    </Panel>

    {(creating || editing) && <Modal title={editing?._created ? 'Account created' : editing?._id ? 'Edit person' : 'Add a person'} onClose={closeModal} size="wide">
      {editing?._created ? <div className="created-result"><div className="created-mark"><UserRoundPlus size={22} /></div><h3>They’re on the team.</h3><p>{success || 'Share the temporary password securely. It will only be shown now.'}</p><div className="credential-card"><span>ONE-TIME TEMPORARY PASSWORD</span><code>{temporaryPassword}</code><small>The employee will be asked to set a new password at first sign in.</small></div><button className="button button-primary button-wide" onClick={closeModal}>Done</button></div> : <form className="form-stack" onSubmit={submit}><p className="modal-copy">{editing ? 'Update this teammate’s profile, department, and access.' : 'Create a secure Vande OS employee account.'}</p><ErrorBanner>{error}</ErrorBanner><SuccessBanner>{success}</SuccessBanner><div className="form-grid"><label>Full name<input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength="120" /></label><label>Work email<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required disabled={Boolean(editing)} /></label><label>Job title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Product designer" /></label><label>Phone number<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Optional" /></label><label>Division<select value={form.division} onChange={e => { const division = e.target.value; const first = departments.find(item => item.division?._id === division); setForm({ ...form, division, department: first?._id || '' }); }} required><option value="">Choose a division</option>{divisions.filter(item => item.active).map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Department<select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} required><option value="">Choose a department</option>{availableDepartments.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Flexible shift<select value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}><option value="">No shift assigned</option>{shifts.filter(item => item.active).map(item => <option key={item._id} value={item._id}>{item.name} · {item.startTime}–{item.endTime}</option>)}</select></label><label>Employment type<select value={form.employmentType} onChange={e => setForm({ ...form, employmentType: e.target.value })}><option value="FULL_TIME">Full time</option><option value="PART_TIME">Part time</option><option value="CONTRACT">Contract</option></select></label>{user.role === 'SUPER_ADMIN' && <label>Access role<select value={form.role} onChange={e => { const role = e.target.value; setForm({ ...form, role, workspacePermissions: defaultPermissions(role) }); }}><option value="EMPLOYEE">Employee</option><option value="HR">HR</option><option value="SUPER_ADMIN">Super Admin</option></select><small className="field-hint">HR can manage people, attendance, and leave reviews.</small></label>}{['EMPLOYEE', 'HR'].includes(form.role) && <fieldset className="employee-permissions form-span-two"><legend>Allowed work areas</legend><p>Choose the areas this person needs for their job title. Employees only see assigned or self-created work. HR access remains limited by role and these selected work areas.</p><div>{(form.role === 'HR' ? hrWorkspaceModules : employeeWorkspaceModules).map(module => <label key={module} className="checkbox-field"><input type="checkbox" checked={form.workspacePermissions.includes(module)} onChange={e => setForm({ ...form, workspacePermissions: e.target.checked ? [...new Set([...form.workspacePermissions, module])] : form.workspacePermissions.filter(item => item !== module) })} /><span><strong>{titleCase(module)}</strong></span></label>)}</div></fieldset>}<label className="checkbox-field"><input type="checkbox" checked={form.remoteApproved} onChange={e => setForm({ ...form, remoteApproved: e.target.checked })} /><span><strong>Approved for remote work</strong><small>Allows web-based attendance without office GPS.</small></span></label>{editing && <label className="checkbox-field"><input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} /><span><strong>Account active</strong><small>Inactive accounts cannot sign in.</small></span></label>}</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={closeModal}>Cancel</button>{editing?._id && <button type="button" className="button button-danger-ghost" onClick={() => { deactivate(editing); closeModal(); }}>Deactivate</button>}<button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create account'}</button></div></form>}
    </Modal>}
  </>;
}
