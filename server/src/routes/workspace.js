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
  return { $or: [{ assignedTo: req.user._id }, { createdBy: req.user._id }] };
}

function canAccessModule(req, module, config = modules[module]) {
  return hasWorkspaceModuleAccess(req.user, module, config);
}

function canWrite(req, module, config = modules[module]) {
  return canWriteWorkspaceModule(req.user, module, config);
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
  if (!config.statuses.includes(status)) {
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
  const config = modules[module];
  if (!config) return res.status(404).json({ success: false, message: 'Workspace module not found.' });
  const portalTicket = req.user.role === 'CLIENT' && module === 'support';
  const portalSubmission = req.user.role === 'STUDENT' && module === 'academy';
  if ((!canAccessModule(req, module, config) || !canWrite(req, module, config)) && !portalTicket && !portalSubmission) return res.status(403).json({ success: false, message: 'Your account does not have permission to create records here.' });
  const parsedInput = validateInput(req.body || {});
  if (parsedInput.portalEmail && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HR') return res.status(403).json({ success: false, message: 'Only workspace staff can provision portal accounts.' });
  const input = normalizeInput(parsedInput, module, config);
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
  const config = modules[module];
  if (!config) return res.status(404).json({ success: false, message: 'Workspace module not found.' });
  if (!canAccessModule(req, module, config) || !canWrite(req, module, config)) return res.status(403).json({ success: false, message: 'Your account does not have permission to update records here.' });
  const record = await WorkspaceRecord.findOne({ _id: req.params.id, module, archivedAt: null, ...recordScope(req, module) });
  if (!record) return res.status(404).json({ success: false, message: 'Record not found.' });
  if (Object.hasOwn(req.body || {}, 'stockQuantity')) return res.status(400).json({ success: false, message: 'Use an inventory movement to change stock quantity.' });
  if (module === 'inventory' && record.kind === 'movement') return res.status(400).json({ success: false, message: 'Inventory movements are immutable. Record a correcting stock movement instead.' });
  if (module === 'finance' && record.kind === 'payment') return res.status(400).json({ success: false, message: 'Payment records are immutable. Contact an administrator to correct a payment.' });
  if (module === 'academy' && record.kind === 'submission') return res.status(400).json({ success: false, message: 'Use the submission review action to approve or reject student work.' });
  if (req.body?.kind && req.body.kind !== record.kind) return res.status(400).json({ success: false, message: 'Record type cannot be changed after creation.' });
  if (Object.hasOwn(req.body || {}, 'portalEmail')) return res.status(400).json({ success: false, message: 'Portal account email cannot be changed here.' });
  const patch = validateInput(req.body || {}, true);
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
  for (const key of ['kind', 'title', 'description', 'status', 'data', 'assignedTo', 'parent', 'client', 'student', 'dueDate', 'amount', 'minStockLevel', 'currency']) {
    if (input[key] !== undefined) record[key] = input[key];
  }
  await record.save();
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
  const config = modules[module];
  if (!config) return res.status(404).json({ success: false, message: 'Workspace module not found.' });
  if (!canAccessModule(req, module, config) || !canWrite(req, module, config)) return res.status(403).json({ success: false, message: 'Your account does not have permission to archive records here.' });
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

export default router;
export { modules as workspaceModules, recordScope as workspaceRecordScope, canWrite as canWriteWorkspaceRecord, canAccessModule as canAccessWorkspaceModule };
