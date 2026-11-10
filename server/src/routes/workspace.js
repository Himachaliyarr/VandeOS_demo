import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import WorkspaceRecord from '../models/WorkspaceRecord.js';
import User from '../models/User.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { notify, notifyRole } from '../services/notifications.js';
import { invoiceBalance, stockStatus } from '../services/workspacePolicy.js';
import { canWriteWorkspaceModule, hasWorkspaceModuleAccess, reportAccess } from '../services/workspaceAccess.js';
import { parseCrmCsv, serializeCrmCsv } from '../services/crmCsv.js';
import CrmSavedView from '../models/CrmSavedView.js';
import CrmSyncConflict from '../models/CrmSyncConflict.js';
import { calculateLeadScore, crmConfigurationResponse, crmRolePermission, getCrmConfiguration, validateCrmFields } from '../services/crmConfiguration.js';
import { runCrmStageAutomations } from '../services/crmAutomation.js';
import { createSalesforceAuthorizationUrl, exchangeSalesforceCode, resolveCrmSalesforceConflict, syncCrmWithSalesforce } from '../services/crmSalesforce.js';

const router = Router();
const staff = allowRoles('SUPER_ADMIN', 'HR');
const modules = {
  crm: { roles: ['SUPER_ADMIN', 'HR', 'CLIENT'], kinds: ['lead', 'client', 'contact', 'deal', 'activity'], statuses: ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST', 'ACTIVE', 'INACTIVE', 'OPEN', 'DONE'] },
  projects: { roles: ['SUPER_ADMIN', 'HR', 'EMPLOYEE', 'CLIENT'], kinds: ['project', 'task'], statuses: ['PLANNED', 'ACTIVE', 'ON_HOLD', 'DONE', 'OPEN', 'IN_PROGRESS', 'REVIEW', 'BLOCKED'] },
  academy: { roles: ['SUPER_ADMIN', 'HR', 'STUDENT'], kinds: ['course', 'batch', 'student', 'enrollment', 'assignment', 'submission', 'certificate'], statuses: ['DRAFT', 'ACTIVE', 'COMPLETED', 'PENDING', 'APPROVED', 'REJECTED', 'PUBLISHED'] },
  finance: { roles: ['SUPER_ADMIN', 'CLIENT'], kinds: ['invoice', 'payment', 'expense'], statuses: ['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED', 'PENDING', 'APPROVED', 'REJECTED'] },
  marketing: { roles: ['SUPER_ADMIN', 'HR'], kinds: ['campaign', 'content'], statuses: ['IDEA', 'DRAFT', 'SCHEDULED', 'PUBLISHED', 'PAUSED', 'COMPLETED'] },
  inventory: { roles: ['SUPER_ADMIN', 'HR'], kinds: ['item', 'movement'], statuses: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'RECORDED', 'CANCELLED'] },
  support: { roles: ['SUPER_ADMIN', 'HR', 'EMPLOYEE', 'CLIENT'], kinds: ['ticket', 'message'], statuses: ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'] },
  automations: { roles: ['SUPER_ADMIN'], kinds: ['rule', 'log'], statuses: ['ACTIVE', 'PAUSED', 'SUCCEEDED', 'FAILED'] }
};

const inputSchema = z.object({
  kind: z.string().trim().min(2).max(40),
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(5000).optional().default(''),
  status: z.string().trim().min(2).max(40).optional(),
  data: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/), z.string().max(5000)).optional().default({}),
  assignedTo: z.string().nullable().optional(),
  parent: z.string().nullable().optional(),
  client: z.string().nullable().optional(),
  student: z.string().nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
  amount: z.number().min(0).nullable().optional(),
  stockQuantity: z.number().min(0).optional(),
  minStockLevel: z.number().min(0).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional().default('INR'),
  portalEmail: z.email().optional()
});
const paymentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().trim().max(1000).optional().default(''),
  data: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/), z.string().max(5000)).optional().default({})
});
const movementSchema = z.object({
  direction: z.enum(['IN', 'OUT']),
  quantity: z.number().positive(),
  note: z.string().trim().max(500).optional().default('')
});
const reviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().trim().max(1000).optional().default('')
});

function validateInput(value, partial = false, schema = inputSchema) {
  const parsed = (partial ? schema.partial() : schema).safeParse(value);
  if (!parsed.success) {
    const error = new Error(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    error.status = 400;
    throw error;
  }
  return parsed.data;
}

function validateRequest(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const error = new Error(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    error.status = 400;
    throw error;
  }
  return parsed.data;
}

function recordScope(req, module) {
  if (req.user.role === 'CLIENT') {
    if (!req.user.portalRecord) return { _id: null };
    if (module === 'crm') return { _id: req.user.portalRecord, kind: 'client' };
    return { client: req.user.portalRecord };
  }
  if (req.user.role === 'STUDENT') {
    if (!req.user.portalRecord) return { _id: null };
    return { $or: [{ _id: req.user.portalRecord }, { parent: req.user.portalRecord }, { student: req.user.portalRecord }] };
  }
  if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'HR') return {};
  if (module === 'crm') return { assignedTo: req.user._id };
  return { $or: [{ assignedTo: req.user._id }, { createdBy: req.user._id }] };
}

function canAccessModule(req, module, config = modules[module]) {
  return hasWorkspaceModuleAccess(req.user, module, config);
}

function canWrite(req, module, config = modules[module]) {
  return canWriteWorkspaceModule(req.user, module, config);
}

function canAccessCrm(req, configuration) {
  return canAccessModule(req, 'crm', crmModuleConfiguration(configuration));
}

function crmModuleConfiguration(configuration) {
  const stages = configuration.pipelines instanceof Map
    ? Object.fromEntries(configuration.pipelines)
    : configuration.pipelines || {};
  return {
    ...modules.crm,
    kinds: configuration.recordTypes,
    statuses: [...new Set(Object.values(stages).flat())],
    pipelines: stages
  };
}

function employeeInventoryAccess(req, res, next) {
  return canAccessModule(req, 'inventory')
    ? next()
    : res.status(403).json({ success: false, message: 'Your account does not have inventory access.' });
}

function academyReviewAccess(req, res, next) {
  return ['SUPER_ADMIN', 'HR', 'EMPLOYEE'].includes(req.user.role) && canAccessModule(req, 'academy')
    ? next()
    : res.status(403).json({ success: false, message: 'Your account does not have Academy review access.' });
}

function pageArgs(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

function normalizeInput(input, module, config, existing) {
  if (!config.kinds.includes(input.kind || existing?.kind)) {
    const error = new Error('Choose a record type available in this module.');
    error.status = 400;
    throw error;
  }
  const status = input.status || existing?.status || config.statuses[0];
  const allowedStatuses = module === 'crm' ? config.pipelines?.[input.kind || existing?.kind] || [] : config.statuses;
  if (!(module === 'crm' ? allowedStatuses : config.statuses).includes(status)) {
    const error = new Error('Choose a valid status for this record type.');
    error.status = 400;
    throw error;
  }
  const values = { ...input, module, status };
  if (values.dueDate) values.dueDate = new Date(`${values.dueDate}T00:00:00.000Z`);
  if (values.assignedTo !== undefined) values.assignedTo = values.assignedTo || null;
  if (values.parent !== undefined) values.parent = values.parent || null;
  if (values.client !== undefined) values.client = values.client || null;
  if (values.student !== undefined) values.student = values.student || null;
  if (module === 'inventory' && values.kind === 'item') {
    if (values.stockQuantity === undefined && !existing) values.stockQuantity = 0;
    if (values.minStockLevel === undefined && !existing) values.minStockLevel = 0;
    const stock = values.stockQuantity ?? existing?.stockQuantity ?? 0;
    const minimum = values.minStockLevel ?? existing?.minStockLevel ?? 0;
    values.status = stockStatus(stock, minimum);
  } else {
    delete values.stockQuantity;
    delete values.minStockLevel;
  }
  return values;
}

async function validateLinks(module, kind, parentId, clientId, studentId) {
  if (parentId) {
    const expected = {
      projects: { task: ['projects', 'project'] },
      academy: { assignment: ['academy', 'student'], enrollment: ['academy', 'student'], certificate: ['academy', 'student'], submission: ['academy', 'assignment'] },
      marketing: { content: ['marketing', 'campaign'] },
      support: { message: ['support', 'ticket'] },
      inventory: { movement: ['inventory', 'item'] },
      finance: { payment: ['finance', 'invoice'] }
    }[module]?.[kind];
    if (expected && !await WorkspaceRecord.exists({ _id: parentId, module: expected[0], kind: expected[1], archivedAt: null })) {
      return `Choose a valid ${expected[1]} record for this ${kind}.`;
    }
    if (!expected && !await WorkspaceRecord.exists({ _id: parentId, archivedAt: null })) return 'The related record does not exist.';
  } else if (module === 'support' && kind === 'message') {
    return 'Choose a ticket for this message.';
  } else if (module === 'academy' && ['assignment', 'enrollment', 'certificate'].includes(kind)) {
    return `Choose a student for this ${kind}.`;
  } else if (module === 'academy' && kind === 'submission') {
    return 'Choose the assigned student and assignment for this submission.';
  }
  if (clientId && !await WorkspaceRecord.exists({ _id: clientId, module: 'crm', kind: 'client', archivedAt: null })) return 'Choose an active client record.';
  if (studentId) {
    if (module !== 'academy' || kind !== 'submission') return 'Student links are only valid for Academy submissions.';
    const student = await WorkspaceRecord.findOne({ _id: studentId, module: 'academy', kind: 'student', archivedAt: null }).select('_id');
    if (!student) return 'Choose an active student record.';
    if (!parentId || !await WorkspaceRecord.exists({ _id: parentId, module: 'academy', kind: 'assignment', parent: student._id, archivedAt: null })) {
      return 'The assignment is not linked to this student.';
    }
  }
  if (module === 'academy' && kind === 'submission' && !studentId) return 'Choose the assigned student for this submission.';
  return '';
}

router.use(authenticate);

router.get('/meta', (_req, res) => {
  res.json({ success: true, data: { modules: Object.fromEntries(Object.entries(modules).map(([key, config]) => [key, { kinds: config.kinds, statuses: config.statuses }])) } });
});

router.get('/crm/config', async (req, res) => {
  if (!canAccessModule(req, 'crm')) return res.status(403).json({ success: false, message: 'Your account does not have CRM access.' });
  const configuration = await getCrmConfiguration();
  if (!crmRolePermission(configuration, req.user.role).view) return res.status(403).json({ success: false, message: 'Your account does not have CRM access.' });
  res.json({ success: true, data: { configuration: crmConfigurationResponse(configuration) } });
});

router.patch('/crm/config', async (req, res) => {
  if (!['SUPER_ADMIN', 'HR'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only workspace administrators can change CRM settings.' });
  const input = validateRequest(z.object({
    pipelines: z.record(z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/), z.array(z.string().trim().min(1).max(40)).min(1).max(30)).optional(),
    fields: z.array(z.object({
      key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/),
      label: z.string().trim().min(1).max(80),
      type: z.enum(['TEXT', 'NUMBER', 'DATE', 'SELECT']),
      options: z.array(z.string().trim().min(1).max(80)).max(50).optional().default([]),
      required: z.boolean().optional().default(false),
      kinds: z.array(z.string().max(40)).optional().default([])
    })).max(100).optional(),
    recordTypes: z.array(z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/)).min(1).max(30).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']).optional(),
    scoringRules: z.array(z.object({
      field: z.string().min(1).max(80),
      operator: z.enum(['equals', 'contains', 'present']),
      value: z.string().max(200).optional().default(''),
      points: z.number().int().min(0).max(100)
    })).max(100).optional(),
    permissions: z.record(z.enum(['HR', 'EMPLOYEE', 'CLIENT']), z.object({
      view: z.boolean(),
      edit: z.boolean(),
      export: z.boolean(),
      assign: z.boolean()
    })).optional(),
    emailTemplates: z.array(z.object({
      name: z.string().trim().min(1).max(80),
      subject: z.string().max(200).optional().default(''),
      body: z.string().min(1).max(5000),
      kind: z.enum(['EMAIL', 'ACTIVITY'])
    })).max(50).optional(),
    automations: z.array(z.object({
      name: z.string().trim().min(1).max(80),
      trigger: z.enum(['FOLLOW_UP_DUE', 'STAGE_CHANGED']),
      enabled: z.boolean(),
      stage: z.string().max(40).optional().default(''),
      templateName: z.string().max(80).optional().default(''),
      delayDays: z.number().int().min(0).max(365).optional().default(1)
    })).max(50).optional()
  }), req.body || {});
  const configuration = await getCrmConfiguration();
  if (input.pipelines) configuration.pipelines = input.pipelines;
  for (const [key, value] of Object.entries(input)) {
    if (key !== 'pipelines') configuration[key] = value;
  }
  await configuration.save();
  await audit(req, 'CRM_CONFIGURATION_UPDATED', 'CrmConfiguration', configuration.id, Object.keys(input));
  res.json({ success: true, data: { configuration: crmConfigurationResponse(configuration) } });
});

router.get('/crm/views', async (req, res) => {
  if (!canAccessModule(req, 'crm')) return res.status(403).json({ success: false, message: 'Your account does not have CRM access.' });
  if (!crmRolePermission(await getCrmConfiguration(), req.user.role).view) return res.status(403).json({ success: false, message: 'Your CRM role does not allow viewing saved views.' });
  const views = await CrmSavedView.find({ $or: [{ owner: req.user._id }, { shared: true }] }).sort({ updatedAt: -1 }).lean();
  res.json({ success: true, data: { views } });
});

router.post('/crm/views', async (req, res) => {
  if (!canAccessModule(req, 'crm')) return res.status(403).json({ success: false, message: 'Your account does not have CRM access.' });
  if (!crmRolePermission(await getCrmConfiguration(), req.user.role).view) return res.status(403).json({ success: false, message: 'Your account does not have CRM access.' });
  const input = validateRequest(z.object({
    name: z.string().trim().min(1).max(80),
    shared: z.boolean().optional().default(false),
    layout: z.enum(['TABLE', 'KANBAN', 'CALENDAR']).optional().default('TABLE'),
    filters: z.object({
      kind: z.string().max(40).optional().default(''),
      status: z.string().max(40).optional().default(''),
      assignedTo: z.string().max(40).optional().default(''),
      search: z.string().max(100).optional().default(''),
      overdue: z.boolean().optional().default(false)
    }).optional().default({})
  }), req.body || {});
  const view = await CrmSavedView.create({ ...input, owner: req.user._id });
  await audit(req, 'CRM_SAVED_VIEW_CREATED', 'CrmSavedView', view.id, { shared: view.shared });
  res.status(201).json({ success: true, data: { view } });
});

router.delete('/crm/views/:id', async (req, res) => {
  if (!canAccessModule(req, 'crm')) return res.status(403).json({ success: false, message: 'Your account does not have CRM access.' });
  if (!crmRolePermission(await getCrmConfiguration(), req.user.role).view) return res.status(403).json({ success: false, message: 'Your CRM role does not allow managing saved views.' });
  const view = await CrmSavedView.findOneAndDelete({ _id: req.params.id, owner: req.user._id });
  if (!view) return res.status(404).json({ success: false, message: 'Saved view not found.' });
  await audit(req, 'CRM_SAVED_VIEW_DELETED', 'CrmSavedView', view.id);
  res.json({ success: true, message: 'Saved view deleted.' });
});

router.get('/crm/conflicts', async (req, res) => {
  if (!['SUPER_ADMIN', 'HR'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Only workspace administrators can review sync conflicts.' });
  const conflicts = await CrmSyncConflict.find({ status: 'OPEN' }).populate('record').sort({ createdAt: 1 }).limit(100);
  res.json({ success: true, data: { conflicts } });
});

router.post('/crm/salesforce/connect', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ success: false, message: 'Only the workspace Owner can connect Salesforce.' });
  const configuration = await getCrmConfiguration();
  const authorizationUrl = createSalesforceAuthorizationUrl(configuration);
  await configuration.save();
  res.json({ success: true, data: { authorizationUrl } });
});

router.get('/crm/salesforce/callback', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ success: false, message: 'Only the workspace Owner can connect Salesforce.' });
  if (req.query.error) return res.status(400).json({ success: false, message: `Salesforce authorization failed: ${String(req.query.error_description || req.query.error).slice(0, 300)}` });
  const configuration = await getCrmConfiguration();
  await exchangeSalesforceCode(configuration, String(req.query.code || ''), String(req.query.state || ''));
  const clientUrl = new URL(process.env.CLIENT_URL || 'http://localhost:5173');
  clientUrl.pathname = '/crm';
  clientUrl.search = '?salesforce=connected';
  res.redirect(clientUrl.toString());
});

router.post('/crm/salesforce/sync', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ success: false, message: 'Only the workspace Owner can run Salesforce sync.' });
  await syncCrmWithSalesforce();
  res.json({ success: true, message: 'Salesforce sync completed.' });
});

router.delete('/crm/salesforce/connect', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ success: false, message: 'Only the workspace Owner can disconnect Salesforce.' });
  const configuration = await getCrmConfiguration();
  configuration.salesforce.enabled = false;
  configuration.salesforce.refreshTokenEncrypted = '';
  configuration.salesforce.instanceUrl = '';
  configuration.salesforce.lastSyncError = '';
  await configuration.save();
  res.json({ success: true, message: 'Salesforce disconnected. Existing CRM records and sync history were kept.' });
});

router.patch('/crm/conflicts/:id', async (req, res) => {
  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HR') return res.status(403).json({ success: false, message: 'Only workspace administrators can resolve sync conflicts.' });
  const { resolution } = validateRequest(z.object({ resolution: z.enum(['LOCAL', 'SALESFORCE']) }), req.body || {});
  const conflict = await CrmSyncConflict.findOne({ _id: req.params.id, status: 'OPEN' });
  if (!conflict) return res.status(404).json({ success: false, message: 'Open Salesforce conflict not found.' });
  conflict.resolvedBy = req.user._id;
  await resolveCrmSalesforceConflict(conflict, resolution);
  res.json({ success: true, message: `Conflict resolved using the ${resolution === 'LOCAL' ? 'VandeOS' : 'Salesforce'} record.` });
});

router.get('/crm/export.csv', async (req, res) => {
  const configuration = await getCrmConfiguration();
  if (!canAccessCrm(req, configuration) || !crmRolePermission(configuration, req.user.role).export) return res.status(403).json({ success: false, message: 'Your CRM role does not allow exporting records.' });
  const records = await WorkspaceRecord.find({ module: 'crm', archivedAt: null, ...recordScope(req, 'crm') }).sort({ createdAt: 1 }).lean();
  res.type('text/csv; charset=utf-8')
    .set('Content-Disposition', 'attachment; filename="crm-export.csv"')
    .send(serializeCrmCsv(records));
});

router.post('/crm/import.csv', async (req, res) => {
  const configuration = await getCrmConfiguration();
  if (!canAccessCrm(req, configuration) || !crmRolePermission(configuration, req.user.role).edit) return res.status(403).json({ success: false, message: 'Your CRM role does not allow importing records.' });
  let inputs;
  try {
    inputs = parseCrmCsv(req.body);
    inputs = inputs.map((input, index) => {
      try {
        const values = validateInput(input);
        validateCrmFields(values, configuration);
        return normalizeInput(values, 'crm', crmModuleConfiguration(configuration));
      } catch (error) {
        error.message = `CSV row ${index + 2}: ${error.message}`;
        throw error;
      }
    });
  } catch (error) {
    error.status = 400;
    throw error;
  }
  const records = await WorkspaceRecord.insertMany(inputs.map(input => ({ ...input, assignedTo: req.user._id, createdBy: req.user._id })));
  await audit(req, 'CRM_RECORDS_IMPORTED', 'WorkspaceRecord', '', { count: records.length });
  res.status(201).json({ success: true, data: { imported: records.length } });
});

router.get('/crm', async (req, res) => {
  if (!canAccessModule(req, 'crm')) return res.status(403).json({ success: false, message: 'Your account does not have CRM access.' });
  const configuration = await getCrmConfiguration();
  if (!crmRolePermission(configuration, req.user.role).view) return res.status(403).json({ success: false, message: 'Your CRM role does not allow viewing records.' });
  const { page, limit, skip } = pageArgs(req);
  const scope = { module: 'crm', archivedAt: null, ...recordScope(req, 'crm') };
  if (req.query.kind && configuration.recordTypes.includes(String(req.query.kind))) scope.kind = String(req.query.kind);
  const filters = {};
  if (req.query.view) {
    const view = await CrmSavedView.findOne({
      _id: req.query.view,
      $or: [{ owner: req.user._id }, { shared: true }]
    }).lean();
    if (view) Object.assign(filters, view.filters);
  }
  const kind = String(req.query.kind || filters.kind || '');
  const status = String(req.query.status || filters.status || '');
  const assignedTo = String(req.query.assignedTo || filters.assignedTo || '');
  if (kind && configuration.recordTypes.includes(kind)) scope.kind = kind;
  const pipeline = configuration.pipelines instanceof Map
    ? configuration.pipelines.get(kind)
    : configuration.pipelines?.[kind];
  if (status && (!kind || pipeline?.includes(status))) scope.status = status;
  if (assignedTo) scope.assignedTo = assignedTo === 'me' ? req.user._id : assignedTo;
  if (req.query.overdue === 'true' || filters.overdue) {
    scope.dueDate = { $lt: new Date() };
    scope.status = { $nin: ['DONE', 'WON', 'LOST', 'CANCELLED'] };
  }
  const search = String(req.query.search || filters.search || '').trim().slice(0, 100);
  if (search) {
    const value = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    scope.$or = [
      { title: { $regex: value, $options: 'i' } },
      { description: { $regex: value, $options: 'i' } },
      ...configuration.fields.map(field => ({ [`data.${field.key}`]: { $regex: value, $options: 'i' } }))
    ];
  }
  const [records, total] = await Promise.all([
    WorkspaceRecord.find(scope).populate('createdBy', 'name').populate('assignedTo', 'name employeeId').populate('client', 'title kind').sort({ dueDate: 1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
    WorkspaceRecord.countDocuments(scope)
  ]);
  const data = records.map(record => ({ ...record, score: record.kind === 'lead' ? calculateLeadScore(record, configuration) : undefined }));
  res.json({ success: true, data: { records: data }, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

router.get('/crm/reports', async (req, res) => {
  if (!canAccessModule(req, 'crm')) return res.status(403).json({ success: false, message: 'Your account does not have CRM access.' });
  const configuration = await getCrmConfiguration();
  if (!crmRolePermission(configuration, req.user.role).view) {
    return res.status(403).json({ success: false, message: 'Your CRM role does not allow viewing reports.' });
  }
  const scope = { module: 'crm', archivedAt: null, ...recordScope(req, 'crm') };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const recordFilter = { ...scope, kind: { $in: ['lead', 'deal'] } };
  const [statuses, sources, owners, overdue, totalsRows] = await Promise.all([
    WorkspaceRecord.aggregate([
      { $match: recordFilter },
      { $group: { _id: { kind: '$kind', status: '$status' }, count: { $sum: 1 }, amount: { $sum: { $ifNull: ['$amount', 0] } } } },
      { $sort: { '_id.kind': 1, count: -1 } }
    ]),
    WorkspaceRecord.aggregate([
      { $match: { ...scope, kind: 'lead', 'data.source': { $nin: ['', null] } } },
      { $group: { _id: '$data.source', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 10 }
    ]),
    WorkspaceRecord.aggregate([
      { $match: recordFilter },
      { $group: { _id: '$assignedTo', count: { $sum: 1 }, wonDeals: { $sum: { $cond: [{ $and: [{ $eq: ['$kind', 'deal'] }, { $eq: ['$status', 'WON'] }] }, 1, 0] } }, wonRevenue: { $sum: { $cond: [{ $and: [{ $eq: ['$kind', 'deal'] }, { $eq: ['$status', 'WON'] }] }, { $ifNull: ['$amount', 0] }, 0] } } } },
      { $sort: { wonRevenue: -1, count: -1 } },
      { $limit: 10 }
    ]),
    WorkspaceRecord.countDocuments({
      ...scope,
      kind: 'activity',
      'data.interactionType': 'TASK',
      dueDate: { $lt: today },
      status: { $nin: ['DONE', 'WON', 'LOST', 'CANCELLED', 'INACTIVE'] }
    }),
    WorkspaceRecord.aggregate([
      { $match: recordFilter },
      { $group: { _id: null, leads: { $sum: { $cond: [{ $eq: ['$kind', 'lead'] }, 1, 0] } }, qualifiedLeads: { $sum: { $cond: [{ $and: [{ $eq: ['$kind', 'lead'] }, { $in: ['$status', ['QUALIFIED', 'PROPOSAL', 'WON']] }] }, 1, 0] } }, deals: { $sum: { $cond: [{ $eq: ['$kind', 'deal'] }, 1, 0] } }, wonDeals: { $sum: { $cond: [{ $and: [{ $eq: ['$kind', 'deal'] }, { $eq: ['$status', 'WON'] }] }, 1, 0] } }, openDeals: { $sum: { $cond: [{ $and: [{ $eq: ['$kind', 'deal'] }, { $not: [{ $in: ['$status', ['WON', 'LOST', 'CANCELLED']] }] }] }, 1, 0] } }, wonRevenue: { $sum: { $cond: [{ $and: [{ $eq: ['$kind', 'deal'] }, { $eq: ['$status', 'WON'] }] }, { $ifNull: ['$amount', 0] }, 0] } } } }
    ])
  ]);
  const ownerIds = owners.map(owner => owner._id).filter(Boolean);
  const ownerRecords = ownerIds.length
    ? await User.find({ _id: { $in: ownerIds } }).select('name').lean()
    : [];
  const ownerNames = new Map(ownerRecords.map(owner => [String(owner._id), owner.name]));
  const ownerSummary = owners.map(owner => ({
    ownerId: owner._id,
    ownerName: ownerNames.get(String(owner._id)) || 'Unassigned',
    count: owner.count,
    wonDeals: owner.wonDeals,
    wonRevenue: owner.wonRevenue
  }));
  const totals = totalsRows[0] || { leads: 0, qualifiedLeads: 0, deals: 0, wonDeals: 0, openDeals: 0, wonRevenue: 0 };
  const conversionRate = totals.deals ? Math.round((totals.wonDeals / totals.deals) * 1000) / 10 : 0;
  res.json({
    success: true,
    data: {
      summary: {
        ...totals,
        conversionRate,
        overdue
      },
      pipeline: statuses,
      leadSources: sources,
      owners: ownerSummary
    }
  });
});

router.get('/crm/:id/timeline', async (req, res) => {
  if (!canAccessModule(req, 'crm')) return res.status(403).json({ success: false, message: 'Your account does not have CRM access.' });
  const configuration = await getCrmConfiguration();
  if (!crmRolePermission(configuration, req.user.role).view) {
    return res.status(403).json({ success: false, message: 'Your CRM role does not allow viewing records.' });
  }
  const parent = await WorkspaceRecord.findOne({
    _id: req.params.id,
    module: 'crm',
    kind: { $in: ['lead', 'client', 'contact', 'deal'] },
    archivedAt: null,
    ...recordScope(req, 'crm')
  }).select('_id');
  if (!parent) return res.status(404).json({ success: false, message: 'CRM record not found.' });
  const timeline = await WorkspaceRecord.find({
    module: 'crm',
    kind: 'activity',
    parent: parent._id,
    archivedAt: null
  }).populate('createdBy assignedTo', 'name').sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, data: { timeline } });
});

router.post('/crm/:id/timeline', async (req, res) => {
  if (!canAccessModule(req, 'crm')) return res.status(403).json({ success: false, message: 'Your account does not have CRM access.' });
  const configuration = await getCrmConfiguration();
  if (!crmRolePermission(configuration, req.user.role).edit) {
    return res.status(403).json({ success: false, message: 'Your CRM role does not allow adding timeline entries.' });
  }
  const input = validateRequest(z.object({
    type: z.enum(['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TASK']),
    title: z.string().trim().min(2).max(180),
    description: z.string().trim().max(5000).optional().default(''),
    occurredAt: z.iso.datetime().optional(),
    dueDate: z.iso.date().nullable().optional()
  }), req.body || {});
  const parent = await WorkspaceRecord.findOne({
    _id: req.params.id,
    module: 'crm',
    kind: { $in: ['lead', 'client', 'contact', 'deal'] },
    archivedAt: null,
    ...recordScope(req, 'crm')
  }).select('_id title');
  if (!parent) return res.status(404).json({ success: false, message: 'CRM record not found.' });
  if (input.dueDate && input.type !== 'TASK') {
    return res.status(400).json({ success: false, message: 'A due date can only be set for a follow-up task.' });
  }
  const activity = await WorkspaceRecord.create({
    module: 'crm',
    kind: 'activity',
    title: input.title,
    description: input.description,
    status: input.type === 'TASK' ? 'OPEN' : 'DONE',
    parent: parent._id,
    assignedTo: req.user._id,
    createdBy: req.user._id,
    dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null,
    data: {
      interactionType: input.type,
      occurredAt: input.occurredAt || new Date().toISOString()
    }
  });
  await audit(req, 'CRM_TIMELINE_ENTRY_CREATED', 'WorkspaceRecord', activity.id, {
    parent: parent.id,
    type: input.type
  });
  await notifyRole(['SUPER_ADMIN', 'HR'], 'CRM timeline updated', `${req.user.name} added ${input.type.toLowerCase()} to ${parent.title}.`, 'INFO', '/crm');
  res.status(201).json({ success: true, data: { activity } });
});

router.get('/:module', async (req, res) => {
  const { module } = req.params;
  const config = modules[module];
  if (!config) return res.status(404).json({ success: false, message: 'Workspace module not found.' });
  if (!canAccessModule(req, module, config)) return res.status(403).json({ success: false, message: 'Your account does not have access to this work area.' });
  const { page, limit, skip } = pageArgs(req);
  const filter = { module, archivedAt: null, ...recordScope(req, module) };
  if (req.query.kind && config.kinds.includes(String(req.query.kind))) filter.kind = String(req.query.kind);
  if (req.query.status && config.statuses.includes(String(req.query.status))) filter.status = String(req.query.status);
  if (req.query.search) {
    const value = String(req.query.search).trim().slice(0, 100);
    filter.$and = [{ $or: [{ title: { $regex: value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { description: { $regex: value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }] }];
  }
  const [records, total] = await Promise.all([
    WorkspaceRecord.find(filter).populate('createdBy', 'name').populate('assignedTo', 'name employeeId').populate('parent', 'title kind').populate('client', 'title kind').populate('student', 'title kind').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    WorkspaceRecord.countDocuments(filter)
  ]);
  res.json({ success: true, data: { records }, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

router.post('/:module', async (req, res) => {
  const { module } = req.params;
  const configuration = module === 'crm' ? await getCrmConfiguration() : null;
  const config = module === 'crm' ? crmModuleConfiguration(configuration) : modules[module];
  if (!config) return res.status(404).json({ success: false, message: 'Workspace module not found.' });
  const portalTicket = req.user.role === 'CLIENT' && module === 'support';
  const portalSubmission = req.user.role === 'STUDENT' && module === 'academy';
  if (module === 'crm' && (!canAccessCrm(req, configuration) || !crmRolePermission(configuration, req.user.role).edit)) return res.status(403).json({ success: false, message: 'Your CRM role does not allow creating records.' });
  if (module !== 'crm' && (!canAccessModule(req, module, config) || !canWrite(req, module, config)) && !portalTicket && !portalSubmission) return res.status(403).json({ success: false, message: 'Your account does not have permission to create records here.' });
  const parsedInput = validateInput(req.body || {});
  if (module === 'crm') validateCrmFields(parsedInput, configuration);
  if (parsedInput.portalEmail && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HR') return res.status(403).json({ success: false, message: 'Only workspace staff can provision portal accounts.' });
  const input = normalizeInput(parsedInput, module, config);
  if (module === 'crm' && !input.assignedTo) input.assignedTo = req.user._id;
  if (portalTicket) {
    if (!req.user.portalRecord || input.kind !== 'ticket') return res.status(403).json({ success: false, message: 'This client account cannot open that type of support record.' });
    input.client = req.user.portalRecord;
    input.assignedTo = null;
  }
  if (portalSubmission) {
    if (!req.user.portalRecord || input.kind !== 'submission' || !input.parent || !await WorkspaceRecord.exists({ _id: input.parent, module: 'academy', kind: 'assignment', archivedAt: null, parent: req.user.portalRecord })) {
      return res.status(403).json({ success: false, message: 'Choose one of your assigned Academy assignments to submit.' });
    }
    if (await WorkspaceRecord.exists({ module: 'academy', kind: 'submission', parent: input.parent, student: req.user.portalRecord, archivedAt: null })) {
      return res.status(409).json({ success: false, message: 'You already submitted work for this assignment.' });
    }
    input.student = req.user.portalRecord;
    input.assignedTo = null;
    input.status = 'PENDING';
  }
  if (req.user.role === 'EMPLOYEE' && input.client) return res.status(403).json({ success: false, message: 'Only HR or the Owner can link client records.' });
  if (req.user.role === 'EMPLOYEE' && Object.hasOwn(req.body || {}, 'assignedTo') && input.assignedTo && String(input.assignedTo) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Employees can only assign work to themselves.' });
  }
  const portalRole = module === 'crm' && input.kind === 'client' ? 'CLIENT' : module === 'academy' && input.kind === 'student' ? 'STUDENT' : null;
  if (input.portalEmail && !portalRole) return res.status(400).json({ success: false, message: 'Portal access can only be created for client and student records.' });
  if (input.portalEmail && await User.exists({ email: input.portalEmail.toLowerCase() })) return res.status(409).json({ success: false, message: 'An account already uses that portal email.' });
  if (module === 'crm' && input.assignedTo && !crmRolePermission(configuration, req.user.role).assign && String(input.assignedTo) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Your CRM role does not allow assigning records to other users.' });
  }
  if (input.assignedTo && !await User.exists({ _id: input.assignedTo, active: true, role: { $in: ['SUPER_ADMIN', 'HR', 'EMPLOYEE'] } })) {
    return res.status(400).json({ success: false, message: 'Choose an active staff member for assignment.' });
  }
  const linkError = await validateLinks(module, input.kind, input.parent, input.client, input.student);
  if (linkError) return res.status(400).json({ success: false, message: linkError });
  if (module === 'inventory' && input.kind === 'movement') return res.status(400).json({ success: false, message: 'Use the stock adjustment action to record an inventory movement.' });
  if (module === 'finance' && input.kind === 'payment') return res.status(400).json({ success: false, message: 'Record payments from an invoice so its balance is updated.' });
  if (module === 'academy' && input.kind === 'submission' && !portalSubmission) return res.status(400).json({ success: false, message: 'Submit work from the student portal.' });
  const record = await WorkspaceRecord.create({ ...input, portalEmail: undefined, createdBy: req.user._id });
  let temporaryPassword;
  if (input.portalEmail) {
    temporaryPassword = randomBytes(12).toString('base64url');
    try {
      await User.create({
        name: input.data.contactName || input.data.studentName || input.title,
        email: input.portalEmail.toLowerCase(),
        passwordHash: temporaryPassword,
        role: portalRole,
        portalRecord: record._id,
        mustChangePassword: true
      });
    } catch (error) {
      await record.deleteOne();
      throw error;
    }
  }
  await audit(req, 'WORKSPACE_RECORD_CREATED', 'WorkspaceRecord', record.id, { module, kind: record.kind, status: record.status });
  if (record.assignedTo && String(record.assignedTo) !== String(req.user._id)) {
    await notify(record.assignedTo, 'Work assigned to you', `“${record.title}” was assigned to you.`, 'INFO', `/${module}`);
  }
  if (module === 'support' && record.kind === 'ticket') await notifyRole(['HR', 'SUPER_ADMIN'], 'Support ticket opened', `${req.user.name} opened “${record.title}”.`, 'INFO', '/support');
  if (module === 'academy' && ['assignment', 'enrollment'].includes(record.kind)) {
    const learner = await User.findOne({ portalRecord: record.parent, role: 'STUDENT', active: true }).select('_id');
    if (learner) await notify(learner._id, record.kind === 'assignment' ? 'New Academy assignment' : 'Academy enrollment updated', `“${record.title}” is available in your student portal.`, 'INFO', '/portal/student');
  }
  res.status(201).json({ success: true, data: { record, ...(temporaryPassword ? { temporaryPassword } : {}) } });
});

router.post('/finance/:id/payments', allowRoles('SUPER_ADMIN'), async (req, res) => {
  const input = validateInput(req.body || {}, false, paymentSchema);
  const invoice = await WorkspaceRecord.findOne({ _id: req.params.id, module: 'finance', kind: 'invoice', archivedAt: null });
  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
  if (!invoice.amount || invoice.amount <= 0 || invoice.status === 'CANCELLED') return res.status(400).json({ success: false, message: 'This invoice cannot accept a payment.' });
  if (input.amount > invoiceBalance(invoice.amount, invoice.paidAmount || 0)) return res.status(409).json({ success: false, message: 'Payment exceeds the invoice balance. Refresh and try again.' });
  if (input.currency !== invoice.currency) return res.status(400).json({ success: false, message: 'Payment currency must match the invoice currency.' });

  const payment = {
    id: randomUUID(),
    amount: input.amount,
    currency: invoice.currency,
    description: input.description,
    recordedBy: req.user._id,
    recordedAt: new Date()
  };
  const updated = await WorkspaceRecord.findOneAndUpdate({
    _id: invoice._id,
    module: 'finance',
    kind: 'invoice',
    archivedAt: null,
    currency: input.currency,
    amount: { $gt: 0 },
    status: { $ne: 'CANCELLED' },
    $expr: { $lte: [{ $add: [{ $ifNull: ['$paidAmount', 0] }, input.amount] }, '$amount'] }
  }, [{
      $set: {
        paidAmount: { $add: [{ $ifNull: ['$paidAmount', 0] }, input.amount] },
        paymentEntries: {
          $concatArrays: [{ $ifNull: ['$paymentEntries', []] }, { $literal: [payment] }]
        },
        status: {
          $cond: [
            { $gte: [{ $add: [{ $ifNull: ['$paidAmount', 0] }, input.amount] }, '$amount'] },
            'PAID',
            'SENT'
          ]
        }
      }
    }], { returnDocument: 'after', updatePipeline: true });
  if (!updated) {
    return res.status(409).json({ success: false, message: 'Payment exceeds the invoice balance or the invoice changed. Refresh and try again.' });
  }
  await audit(req, 'INVOICE_PAYMENT_RECORDED', 'WorkspaceRecord', invoice.id, { payment: payment.id, amount: input.amount, paidAmount: updated.paidAmount });
  res.status(201).json({ success: true, data: { invoice: updated, payment } });
});

router.post('/inventory/:id/movements', employeeInventoryAccess, async (req, res) => {
  const input = validateInput(req.body || {}, false, movementSchema);
  const delta = input.direction === 'IN' ? input.quantity : -input.quantity;
  const movement = {
    id: randomUUID(),
    direction: input.direction,
    quantity: input.quantity,
    note: input.note,
    recordedBy: req.user._id,
    recordedAt: new Date()
  };
  const item = await WorkspaceRecord.findOneAndUpdate({
    _id: req.params.id,
    module: 'inventory',
    kind: 'item',
    archivedAt: null,
    ...recordScope(req, 'inventory'),
    ...(delta < 0 ? { stockQuantity: { $gte: input.quantity } } : {})
  }, [{
    $set: {
      stockQuantity: { $add: [{ $ifNull: ['$stockQuantity', 0] }, delta] },
      stockMovements: {
        $concatArrays: [{ $ifNull: ['$stockMovements', []] }, { $literal: [movement] }]
      },
      status: {
        $let: {
          vars: { quantity: { $add: [{ $ifNull: ['$stockQuantity', 0] }, delta] } },
          in: {
            $cond: [
              { $eq: ['$$quantity', 0] },
              'OUT_OF_STOCK',
              { $cond: [{ $lte: ['$$quantity', { $ifNull: ['$minStockLevel', 0] }] }, 'LOW_STOCK', 'IN_STOCK'] }
            ]
          }
        }
      }
    }
  }], { returnDocument: 'after', updatePipeline: true });
  if (!item) {
    const exists = await WorkspaceRecord.exists({ _id: req.params.id, module: 'inventory', kind: 'item', archivedAt: null, ...recordScope(req, 'inventory') });
    return exists
      ? res.status(409).json({ success: false, message: 'Stock cannot be reduced below zero.' })
      : res.status(404).json({ success: false, message: 'Inventory item not found.' });
  }
  stockStatus(item.stockQuantity, item.minStockLevel);
  await audit(req, 'INVENTORY_MOVEMENT_RECORDED', 'WorkspaceRecord', item.id, { movement: movement.id, direction: input.direction, quantity: input.quantity, stockQuantity: item.stockQuantity });
  res.status(201).json({ success: true, data: { item, movement } });
});

router.post('/academy/:id/review', academyReviewAccess, async (req, res) => {
  const input = validateInput(req.body || {}, false, reviewSchema);
  if (req.user.role === 'EMPLOYEE') {
    const submission = await WorkspaceRecord.findOne({
      _id: req.params.id,
      module: 'academy',
      kind: 'submission',
      archivedAt: null
    }).select('parent');
    if (!submission || !await WorkspaceRecord.exists({
      _id: submission.parent,
      module: 'academy',
      kind: 'assignment',
      assignedTo: req.user._id,
      archivedAt: null
    })) {
      return res.status(404).json({ success: false, message: 'Submission not found in your assigned work.' });
    }
  }
  const submission = await WorkspaceRecord.findOneAndUpdate(
    { _id: req.params.id, module: 'academy', kind: 'submission', archivedAt: null, status: 'PENDING' },
    { $set: { status: input.decision, ...(input.reviewNote ? { 'data.reviewNote': input.reviewNote } : {}) } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!submission) {
    const exists = await WorkspaceRecord.exists({ _id: req.params.id, module: 'academy', kind: 'submission', archivedAt: null });
    return exists
      ? res.status(409).json({ success: false, message: 'Only pending submissions can be reviewed.' })
      : res.status(404).json({ success: false, message: 'Submission not found.' });
  }
  const learner = await User.findOne({ portalRecord: submission.student, role: 'STUDENT', active: true }).select('_id');
  if (learner) {
    await notify(learner._id, `Submission ${input.decision.toLowerCase()}`, `Your submission “${submission.title}” was ${input.decision.toLowerCase()}.${input.reviewNote ? ` Note: ${input.reviewNote}` : ''}`, input.decision === 'APPROVED' ? 'SUCCESS' : 'WARNING', '/portal/student');
  }
  await audit(req, `ACADEMY_SUBMISSION_${input.decision}`, 'WorkspaceRecord', submission.id, { reviewNote: input.reviewNote });
  res.json({ success: true, data: { submission } });
});

router.patch('/:module/:id', async (req, res) => {
  const { module } = req.params;
  const configuration = module === 'crm' ? await getCrmConfiguration() : null;
  const config = module === 'crm' ? crmModuleConfiguration(configuration) : modules[module];
  if (!config) return res.status(404).json({ success: false, message: 'Workspace module not found.' });
  if (module === 'crm' && (!canAccessCrm(req, configuration) || !crmRolePermission(configuration, req.user.role).edit)) return res.status(403).json({ success: false, message: 'Your CRM role does not allow editing records.' });
  if (module !== 'crm' && (!canAccessModule(req, module, config) || !canWrite(req, module, config))) return res.status(403).json({ success: false, message: 'Your account does not have permission to update records here.' });
  const record = await WorkspaceRecord.findOne({ _id: req.params.id, module, archivedAt: null, ...recordScope(req, module) });
  if (!record) return res.status(404).json({ success: false, message: 'Record not found.' });
  if (Object.hasOwn(req.body || {}, 'stockQuantity')) return res.status(400).json({ success: false, message: 'Use an inventory movement to change stock quantity.' });
  if (module === 'inventory' && record.kind === 'movement') return res.status(400).json({ success: false, message: 'Inventory movements are immutable. Record a correcting stock movement instead.' });
  if (module === 'finance' && record.kind === 'payment') return res.status(400).json({ success: false, message: 'Payment records are immutable. Contact an administrator to correct a payment.' });
  if (module === 'academy' && record.kind === 'submission') return res.status(400).json({ success: false, message: 'Use the submission review action to approve or reject student work.' });
  if (req.body?.kind && req.body.kind !== record.kind) return res.status(400).json({ success: false, message: 'Record type cannot be changed after creation.' });
  if (Object.hasOwn(req.body || {}, 'portalEmail')) return res.status(400).json({ success: false, message: 'Portal account email cannot be changed here.' });
  const patch = validateInput(req.body || {}, true);
  if (module === 'crm') {
    const data = patch.data ? { ...Object.fromEntries(record.data || []), ...patch.data } : Object.fromEntries(record.data || []);
    validateCrmFields({ ...patch, kind: record.kind, data }, configuration);
  }
  const input = normalizeInput({
    kind: patch.kind ?? record.kind,
    title: patch.title ?? record.title,
    description: patch.description ?? record.description,
    status: patch.status ?? record.status,
    data: patch.data ?? Object.fromEntries(record.data || []),
    assignedTo: patch.assignedTo === undefined ? String(record.assignedTo || '') || null : patch.assignedTo,
    parent: patch.parent === undefined ? String(record.parent || '') || null : patch.parent,
    client: patch.client === undefined ? String(record.client || '') || null : patch.client,
    student: patch.student === undefined ? String(record.student || '') || null : patch.student,
    dueDate: patch.dueDate === undefined ? record.dueDate?.toISOString().slice(0, 10) || null : patch.dueDate,
    amount: patch.amount === undefined ? record.amount : patch.amount,
    minStockLevel: patch.minStockLevel === undefined ? record.minStockLevel : patch.minStockLevel,
    currency: patch.currency ?? record.currency
  }, module, config, record);
  if (module === 'crm' && Object.hasOwn(req.body || {}, 'assignedTo') && !crmRolePermission(configuration, req.user.role).assign) {
    return res.status(403).json({ success: false, message: 'Your CRM role does not allow assigning records.' });
  }
  if (module === 'finance' && record.kind === 'invoice') {
    if (input.amount !== null && input.amount !== undefined && input.amount < record.paidAmount) return res.status(400).json({ success: false, message: 'Invoice total cannot be lower than the amount already paid.' });
    if (input.status === 'PAID' && record.paidAmount < (input.amount ?? record.amount)) return res.status(400).json({ success: false, message: 'Record payments against the invoice to mark it paid.' });
  }
  if (req.user.role === 'EMPLOYEE' && Object.hasOwn(req.body || {}, 'client')) return res.status(403).json({ success: false, message: 'Only HR or the Owner can link client records.' });
  if (req.user.role === 'EMPLOYEE' && Object.hasOwn(req.body || {}, 'assignedTo') && input.assignedTo && String(input.assignedTo) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Employees can only assign work to themselves.' });
  }
  if (input.assignedTo && !await User.exists({ _id: input.assignedTo, active: true, role: { $in: ['SUPER_ADMIN', 'HR', 'EMPLOYEE'] } })) return res.status(400).json({ success: false, message: 'Choose an active staff member for assignment.' });
  const linkError = await validateLinks(module, record.kind, input.parent, input.client, input.student);
  if (linkError) return res.status(400).json({ success: false, message: linkError });
  const previousAssignedTo = String(record.assignedTo || '');
  const previousStatus = record.status;
  for (const key of ['kind', 'title', 'description', 'status', 'data', 'assignedTo', 'parent', 'client', 'student', 'dueDate', 'amount', 'minStockLevel', 'currency']) {
    if (input[key] !== undefined) record[key] = input[key];
  }
  await record.save();
  if (module === 'crm' && previousStatus !== record.status) await runCrmStageAutomations(record, previousStatus);
  await audit(req, 'WORKSPACE_RECORD_UPDATED', 'WorkspaceRecord', record.id, { module, kind: record.kind, changed: Object.keys(req.body) });
  if (input.assignedTo && String(input.assignedTo) !== String(req.user._id) && String(input.assignedTo) !== previousAssignedTo) {
    await notify(input.assignedTo, 'Work assigned to you', `“${record.title}” was assigned to you.`, 'INFO', `/${module}`);
  }
  if (module === 'support' && record.kind === 'ticket') {
    const recipientIds = new Set([String(record.createdBy), String(record.assignedTo)].filter(id => id && id !== String(req.user._id) && id !== 'null'));
    for (const recipientId of recipientIds) {
      await notify(recipientId, 'Support ticket updated', `“${record.title}” is now ${record.status.toLowerCase().replaceAll('_', ' ')}.`, 'INFO', '/support');
    }
  }
  res.json({ success: true, data: { record } });
});

router.post('/:module/:id/archive', async (req, res) => {
  const { module } = req.params;
  const configuration = module === 'crm' ? await getCrmConfiguration() : null;
  const config = module === 'crm' ? crmModuleConfiguration(configuration) : modules[module];
  if (!config) return res.status(404).json({ success: false, message: 'Workspace module not found.' });
  if (module === 'crm' && (!canAccessCrm(req, configuration) || !crmRolePermission(configuration, req.user.role).edit)) return res.status(403).json({ success: false, message: 'Your CRM role does not allow archiving records.' });
  if (module !== 'crm' && (!canAccessModule(req, module, config) || !canWrite(req, module, config))) return res.status(403).json({ success: false, message: 'Your account does not have permission to archive records here.' });
  const record = await WorkspaceRecord.findOne({ _id: req.params.id, module, archivedAt: null, ...recordScope(req, module) });
  if (!record) return res.status(404).json({ success: false, message: 'Record not found.' });
  if (module === 'inventory' && record.kind === 'item' && record.stockQuantity > 0) return res.status(409).json({ success: false, message: 'Record an issue movement and bring stock to zero before archiving this item.' });
  if (module === 'finance' && record.kind === 'invoice' && (record.paymentEntries?.length || await WorkspaceRecord.exists({ module: 'finance', kind: 'payment', parent: record._id, archivedAt: null }))) {
    return res.status(409).json({ success: false, message: 'Invoices with payment history cannot be archived.' });
  }
  if ((module === 'inventory' && record.kind === 'movement') || (module === 'finance' && record.kind === 'payment')) return res.status(400).json({ success: false, message: 'Financial payment and inventory movement history is immutable.' });
  record.archivedAt = new Date();
  await record.save();
  if (['client', 'student'].includes(record.kind)) await User.updateMany({ portalRecord: record._id }, { $set: { active: false } });
  await audit(req, 'WORKSPACE_RECORD_ARCHIVED', 'WorkspaceRecord', record.id, { module, kind: record.kind });
  res.json({ success: true, message: 'Record archived.' });
});

router.get('/reports/overview', staff, async (req, res) => {
  if (!canAccessModule(req, 'reports', reportAccess)) return res.status(403).json({ success: false, message: 'Your account does not have report access.' });
  const visibleModules = Object.entries(modules).filter(([key, config]) => canAccessModule(req, key, config)).map(([key]) => key);
  const counts = await WorkspaceRecord.aggregate([
    { $match: { module: { $in: visibleModules }, archivedAt: null } },
    { $group: { _id: { module: '$module', status: '$status' }, count: { $sum: 1 }, amount: { $sum: { $ifNull: ['$amount', 0] } } } },
    { $sort: { '_id.module': 1, '_id.status': 1 } }
  ]);
  const overdue = await WorkspaceRecord.countDocuments({ module: { $in: visibleModules }, dueDate: { $lt: new Date() }, status: { $nin: ['DONE', 'PAID', 'CANCELLED', 'RESOLVED', 'CLOSED'] }, archivedAt: null });
  const data = counts.map(row => ({ module: row._id.module, status: row._id.status, count: row.count, ...(row._id.module === 'finance' ? { amount: row.amount } : {}) }));
  res.json({ success: true, data: { counts: data, overdue, generatedAt: new Date().toISOString() } });
});

router.get('/:module/:id', async (req, res) => {
  const { module } = req.params;
  const config = modules[module];
  if (!config) return res.status(404).json({ success: false, message: 'Workspace module not found.' });
  if (!canAccessModule(req, module, config)) return res.status(403).json({ success: false, message: 'Your account does not have access to this work area.' });
  const record = await WorkspaceRecord.findOne({ _id: req.params.id, module, archivedAt: null, ...recordScope(req, module) })
    .populate('createdBy', 'name')
    .populate('assignedTo', 'name employeeId')
    .populate('parent', 'title kind')
    .populate('client', 'title kind')
    .populate('student', 'title kind')
    .lean();
  if (!record) return res.status(404).json({ success: false, message: 'Record not found.' });
  res.json({ success: true, data: { record } });
});

export default router;
export { modules as workspaceModules, recordScope as workspaceRecordScope, canWrite as canWriteWorkspaceRecord, canAccessModule as canAccessWorkspaceModule };
