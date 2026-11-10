import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Division from '../models/Division.js';
import Department from '../models/Department.js';
import Shift from '../models/Shift.js';
import Attendance from '../models/Attendance.js';
import LeaveRequest from '../models/LeaveRequest.js';
import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';
import TenantRegistry from '../models/TenantRegistry.js';
import { authenticate, allowRoles } from '../middleware/auth.js';
import { connectionForTenant, runWithTenant } from '../services/tenantContext.js';
import { audit } from '../services/audit.js';
import { notify, notifyRole } from '../services/notifications.js';
import { checkInPolicy } from '../services/attendancePolicy.js';
import { employeeWorkspaceModules, hrWorkspaceModules } from '../services/workspaceAccess.js';

const router = Router();
const hr = allowRoles('SUPER_ADMIN', 'HR');
const owner = allowRoles('SUPER_ADMIN');
const internal = allowRoles('SUPER_ADMIN', 'HR', 'EMPLOYEE');
const auth = authenticate;

function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    error.status = 400;
    throw error;
  }
  return result.data;
}

function sessionCookieOptions() {
  const crossSite = process.env.NODE_ENV === 'production'
    || process.env.CLIENT_URL?.startsWith('https://');
  return {
    httpOnly: true,
    secure: crossSite || process.env.COOKIE_SECURE === 'true',
    sameSite: crossSite ? 'none' : 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000
  };
}

function todayInTimezone(timeZone = process.env.TIMEZONE || 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function pagination(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

router.get('/health', (_req, res) => res.json({ success: true, status: 'ok', service: 'vande-os-api' }));

// Authentication and organization login.
router.post('/auth/login', async (req, res) => {
  const input = validate(z.object({ organizationSlug: z.string().trim().toLowerCase().min(3).max(40), email: z.email(), password: z.string().min(1) }), req.body);
  const tenant = await TenantRegistry.findOne({ slug: input.organizationSlug, status: 'ACTIVE' });
  if (!tenant) return res.status(401).json({ success: false, message: 'Organization, email, or password is incorrect.' });
  return runWithTenant(connectionForTenant(tenant), async () => {
    const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
    if (!user || !user.active || !await user.verifyPassword(input.password)) {
      await audit(
        { ip: req.ip },
        'AUTH_LOGIN_FAILED',
        'User',
        user?.id || '',
        { reason: !user ? 'USER_NOT_FOUND' : !user.active ? 'ACCOUNT_INACTIVE' : 'INVALID_PASSWORD' }
      );
      return res.status(401).json({ success: false, message: 'Organization, email, or password is incorrect.' });
    }
    user.lastLoginAt = new Date();
    await user.save();
    const token = jwt.sign({ sub: user.id, role: user.role, tenantSlug: tenant.slug }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
    res.cookie('vande_session', token, sessionCookieOptions());
    await audit({ user, ip: req.ip }, 'AUTH_LOGIN', 'User', user.id, {});
    const safeUser = await User.findById(user.id).populate('division department shift');
    res.json({
      success: true,
      data: {
        accessToken: token,
        user: safeUser.toSafeJSON(),
        organization: { name: tenant.name, slug: tenant.slug }
      }
    });
  });
});

router.post('/auth/logout', async (req, res) => {
  if (req.cookies?.vande_session) {
    let payload;
    try {
      payload = jwt.verify(req.cookies.vande_session, process.env.JWT_SECRET);
    } catch { /* expired session is still cleared */ }
    if (payload) {
      const tenant = await TenantRegistry.findOne({ slug: payload.tenantSlug || 'vande-digital', status: 'ACTIVE' });
      if (tenant) await runWithTenant(connectionForTenant(tenant), () => audit({ user: { _id: payload.sub }, ip: req.ip }, 'AUTH_LOGOUT', 'User', payload.sub, {}));
    }
  }
  res.clearCookie('vande_session', { ...sessionCookieOptions(), maxAge: undefined });
  res.json({ success: true, message: 'Signed out.' });
});

router.get('/auth/me', auth, (req, res) => res.json({
  success: true,
  data: {
    user: req.user.toSafeJSON(),
    organization: { name: req.tenant.name, slug: req.tenant.slug }
  }
}));

router.post('/auth/change-password', auth, async (req, res) => {
  const input = validate(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(128) }), req.body);
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!await user.verifyPassword(input.currentPassword)) return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
  user.passwordHash = input.newPassword;
  user.mustChangePassword = false;
  await user.save();
  await audit(req, 'PASSWORD_CHANGED', 'User', user.id);
  res.json({ success: true, message: 'Password updated.' });
});

// Organization structure and single-office attendance policy.
router.get('/organization', auth, internal, async (_req, res) => {
  const organization = await Organization.findOne().populate({ path: 'divisions' });
  res.json({ success: true, data: { organization } });
});

router.patch('/organization/settings', auth, owner, async (req, res) => {
  const input = validate(z.object({
    officeName: z.string().trim().min(2).max(120),
    officeLatitude: z.number().min(-90).max(90).nullable(),
    officeLongitude: z.number().min(-180).max(180).nullable(),
    geofenceRadiusMeters: z.number().int().min(25).max(5000),
    gpsMaxAccuracyMeters: z.number().int().min(10).max(1000),
    timezone: z.string().min(3).max(80)
  }), req.body);
  if ((input.officeLatitude === null) !== (input.officeLongitude === null)) {
    return res.status(400).json({ success: false, message: 'Set both office coordinates, or leave both blank.' });
  }
  const organization = await Organization.findOne();
  organization.timezone = input.timezone;
  organization.settings = { ...organization.settings, ...input };
  await organization.save();
  await audit(req, 'OFFICE_SETTINGS_UPDATED', 'Organization', organization.id, { officeName: input.officeName });
  res.json({ success: true, message: 'Office settings saved.', data: { organization } });
});

router.get('/divisions', auth, internal, async (_req, res) => {
  const divisions = await Division.find().sort({ name: 1 });
  res.json({ success: true, data: { divisions } });
});

router.post('/divisions', auth, owner, async (req, res) => {
  const input = validate(z.object({ name: z.string().trim().min(2).max(100) }), req.body);
  const organization = await Organization.findOne();
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const division = await Division.create({ ...input, slug, organization: organization._id });
  organization.divisions.addToSet(division._id);
  await organization.save();
  await audit(req, 'DIVISION_CREATED', 'Division', division.id, { name: division.name });
  res.status(201).json({ success: true, data: { division } });
});

router.patch('/divisions/:id', auth, owner, async (req, res) => {
  const input = validate(z.object({ name: z.string().trim().min(2).max(100).optional(), active: z.boolean().optional() }), req.body);
  const division = await Division.findByIdAndUpdate(req.params.id, input, { returnDocument: 'after', runValidators: true });
  if (!division) return res.status(404).json({ success: false, message: 'Division not found.' });
  await audit(req, 'DIVISION_UPDATED', 'Division', division.id, input);
  res.json({ success: true, data: { division } });
});

router.get('/departments', auth, internal, async (_req, res) => {
  const departments = await Department.find().populate('division', 'name slug').populate('head', 'name employeeId').sort({ name: 1 });
  res.json({ success: true, data: { departments } });
});

router.post('/departments', auth, owner, async (req, res) => {
  const input = validate(z.object({ name: z.string().trim().min(2).max(100), division: z.string().min(1) }), req.body);
  const division = await Division.findById(input.division);
  if (!division) return res.status(400).json({ success: false, message: 'Choose a valid division.' });
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const department = await Department.create({ ...input, slug, division: division._id });
  await audit(req, 'DEPARTMENT_CREATED', 'Department', department.id, { name: department.name });
  res.status(201).json({ success: true, data: { department } });
});

router.patch('/departments/:id', auth, owner, async (req, res) => {
  const input = validate(z.object({ name: z.string().trim().min(2).max(100).optional(), head: z.string().nullable().optional(), active: z.boolean().optional() }), req.body);
  const department = await Department.findById(req.params.id);
  if (!department) return res.status(404).json({ success: false, message: 'Department not found.' });
  if (input.name) department.name = input.name;
  if (input.head !== undefined) department.head = input.head || null;
  if (input.active !== undefined) department.active = input.active;
  await department.save();
  await audit(req, 'DEPARTMENT_UPDATED', 'Department', department.id, input);
  res.json({ success: true, data: { department } });
});

// Employees: directory read access is available to signed-in staff; writes require HR or Owner.
router.get('/employees/me', auth, internal, async (req, res) => {
  const user = await User.findById(req.user.id).populate('division department shift');
  res.json({ success: true, data: { employee: user.toSafeJSON() } });
});

router.get('/employees', auth, internal, async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const filter = {};
  if (req.query.search) filter.$or = [
    { name: { $regex: String(req.query.search), $options: 'i' } },
    { employeeId: { $regex: String(req.query.search), $options: 'i' } },
    { title: { $regex: String(req.query.search), $options: 'i' } }
  ];
  if (req.query.department) filter.department = req.query.department;
  if (req.query.division) filter.division = req.query.division;
  filter.role = { $in: ['HR', 'EMPLOYEE'] };
  if (req.query.status === 'inactive') filter.active = false;
  else filter.active = true;
  const [employees, total] = await Promise.all([
    User.find(filter).select('name employeeId title role workspacePermissions division department shift employmentType joinedAt remoteApproved active email phone').populate('division department shift').sort({ name: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter)
  ]);
  const data = employees.map(user => {
    const item = user.toSafeJSON();
    if (!['SUPER_ADMIN', 'HR'].includes(req.user.role)) { delete item.phone; }
    return item;
  });
  res.json({ success: true, data: { employees: data }, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

router.post('/employees', auth, hr, async (req, res) => {
  const input = validate(z.object({
    name: z.string().trim().min(2).max(120), email: z.email(), title: z.string().trim().max(120).optional().default(''),
    phone: z.string().trim().max(40).optional().default(''), division: z.string().min(1), department: z.string().min(1),
    shift: z.string().optional().nullable(), role: z.enum(['SUPER_ADMIN', 'HR', 'EMPLOYEE']).optional().default('EMPLOYEE'),
    workspacePermissions: z.array(z.string()).optional(),
    employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT']).optional().default('FULL_TIME'),
    remoteApproved: z.boolean().optional().default(false), joinedAt: z.iso.datetime().optional()
  }), req.body);
  if (req.user.role !== 'SUPER_ADMIN' && input.role !== 'EMPLOYEE') return res.status(403).json({ success: false, message: 'Only the Owner can assign an HR or Super Admin role.' });
  const allowedPermissions = input.role === 'HR' ? hrWorkspaceModules : employeeWorkspaceModules;
  if (input.workspacePermissions?.some(permission => !allowedPermissions.includes(permission))) {
    return res.status(400).json({ success: false, message: 'Choose work areas permitted for this account role.' });
  }
  const [division, department, shift] = await Promise.all([
    Division.findById(input.division), Department.findById(input.department), input.shift ? Shift.findById(input.shift) : null
  ]);
  if (!division?.active || !department?.active || String(department.division) !== String(division._id)) return res.status(400).json({ success: false, message: 'Choose an active department within an active division.' });
  if (input.shift && !shift?.active) return res.status(400).json({ success: false, message: 'Choose an active shift.' });
  const temporaryPassword = randomBytes(9).toString('base64url');
  const employeeId = `VAN-${randomUUID().slice(0, 8).toUpperCase()}`;
  const defaultPermissions = input.role === 'HR' ? hrWorkspaceModules : ['projects', 'support'];
  const employee = await User.create({
    ...input, workspacePermissions: input.workspacePermissions ?? defaultPermissions, email: input.email.toLowerCase(), employeeId, division: division._id, department: department._id,
    shift: shift?._id || null, passwordHash: temporaryPassword, mustChangePassword: true
  });
  await audit(req, 'EMPLOYEE_CREATED', 'User', employee.id, { employeeId, role: employee.role });
  await notify(employee, 'Welcome to Vande OS', 'Your employee account is ready. Change the temporary password after your first sign in.', 'SUCCESS');
  const result = await User.findById(employee.id).populate('division department shift');
  res.status(201).json({ success: true, message: 'Employee created. Share the temporary password securely.', data: { employee: result.toSafeJSON(), temporaryPassword } });
});

router.patch('/employees/:id', auth, hr, async (req, res) => {
  const input = validate(z.object({
    name: z.string().trim().min(2).max(120).optional(), title: z.string().trim().max(120).optional(), phone: z.string().trim().max(40).optional(),
    division: z.string().optional(), department: z.string().optional(), shift: z.string().nullable().optional(),
    role: z.enum(['SUPER_ADMIN', 'HR', 'EMPLOYEE']).optional(), employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT']).optional(),
    workspacePermissions: z.array(z.string()).optional(),
    remoteApproved: z.boolean().optional(), active: z.boolean().optional()
  }), req.body);
  if (req.user.role !== 'SUPER_ADMIN' && input.role) return res.status(403).json({ success: false, message: 'Only the Owner can change access roles.' });
  const employee = await User.findById(req.params.id);
  if (!employee) return res.status(404).json({ success: false, message: 'Employee not found.' });
  const targetRole = input.role || employee.role;
  const allowedPermissions = targetRole === 'HR' ? hrWorkspaceModules : targetRole === 'EMPLOYEE' ? employeeWorkspaceModules : [];
  if (input.workspacePermissions?.some(permission => !allowedPermissions.includes(permission))) {
    return res.status(400).json({ success: false, message: 'Choose work areas permitted for this account role.' });
  }
  if (employee.id === req.user.id && input.role && input.role !== 'SUPER_ADMIN') return res.status(400).json({ success: false, message: 'You cannot remove your own Super Admin access.' });
  if (employee.role === 'SUPER_ADMIN' && input.active === false) return res.status(400).json({ success: false, message: 'The Owner account cannot be deactivated here.' });
  const divisionId = input.division || String(employee.division || '');
  const departmentId = input.department || String(employee.department || '');
  if (input.division || input.department) {
    const department = await Department.findById(departmentId);
    const division = await Division.findById(divisionId);
    if (!department?.active || !division?.active || String(department.division) !== divisionId) return res.status(400).json({ success: false, message: 'Choose an active department within an active division.' });
    employee.division = divisionId;
    employee.department = departmentId;
  }
  if (input.shift !== undefined) {
    if (input.shift && !await Shift.exists({ _id: input.shift, active: true })) return res.status(400).json({ success: false, message: 'Choose an active shift.' });
    employee.shift = input.shift || null;
  }
  for (const key of ['name', 'title', 'phone', 'role', 'employmentType', 'remoteApproved', 'active', 'workspacePermissions']) if (input[key] !== undefined) employee[key] = input[key];
  await employee.save();
  await audit(req, 'EMPLOYEE_UPDATED', 'User', employee.id, Object.keys(input));
  const result = await User.findById(employee.id).populate('division department shift');
  res.json({ success: true, data: { employee: result.toSafeJSON() } });
});

router.post('/employees/:id/deactivate', auth, hr, async (req, res) => {
  const employee = await User.findById(req.params.id);
  if (!employee) return res.status(404).json({ success: false, message: 'Employee not found.' });
  if (employee.role === 'SUPER_ADMIN' || employee.id === req.user.id) return res.status(400).json({ success: false, message: 'This account cannot be deactivated with this action.' });
  employee.active = false;
  await employee.save();
  await audit(req, 'EMPLOYEE_DEACTIVATED', 'User', employee.id, {});
  res.json({ success: true, message: 'Employee deactivated.' });
});

// Configurable flexible shifts.
router.get('/shifts', auth, internal, async (_req, res) => {
  const shifts = await Shift.find().sort({ name: 1 });
  res.json({ success: true, data: { shifts } });
});

router.post('/shifts', auth, hr, async (req, res) => {
  const input = validate(z.object({ name: z.string().trim().min(2).max(100), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), days: z.array(z.number().int().min(0).max(6)).min(1), flexibleWindowMinutes: z.number().int().min(0).max(720) }), req.body);
  const shift = await Shift.create(input);
  await audit(req, 'SHIFT_CREATED', 'Shift', shift.id, input);
  res.status(201).json({ success: true, data: { shift } });
});

router.patch('/shifts/:id', auth, hr, async (req, res) => {
  const input = validate(z.object({ name: z.string().trim().min(2).max(100).optional(), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), days: z.array(z.number().int().min(0).max(6)).min(1).optional(), flexibleWindowMinutes: z.number().int().min(0).max(720).optional(), active: z.boolean().optional() }), req.body);
  const shift = await Shift.findByIdAndUpdate(req.params.id, input, { returnDocument: 'after', runValidators: true });
  if (!shift) return res.status(404).json({ success: false, message: 'Shift not found.' });
  await audit(req, 'SHIFT_UPDATED', 'Shift', shift.id, input);
  res.json({ success: true, data: { shift } });
});

// Attendance. The server timestamps all events and enforces office geofence policy.
router.get('/attendance/me', auth, internal, async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : todayInTimezone().slice(0, 7);
  const records = await Attendance.find({ user: req.user._id, workDate: { $gte: `${month}-01`, $lte: `${month}-31` } }).sort({ workDate: -1 });
  res.json({ success: true, data: { records, workDate: todayInTimezone() } });
});

router.get('/attendance', auth, internal, hr, async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const filter = {};
  if (req.query.date) filter.workDate = String(req.query.date);
  if (req.query.user) filter.user = String(req.query.user);
  if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) filter.workDate = { $gte: `${req.query.month}-01`, $lte: `${req.query.month}-31` };
  const [records, total] = await Promise.all([
    Attendance.find(filter).populate('user', 'name employeeId division department').populate({ path: 'user', populate: [{ path: 'division', select: 'name' }, { path: 'department', select: 'name' }] }).sort({ workDate: -1 }).skip(skip).limit(limit),
    Attendance.countDocuments(filter)
  ]);
  res.json({ success: true, data: { records }, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

router.post('/attendance/check-in', auth, internal, async (req, res) => {
  const input = validate(z.object({ method: z.enum(['OFFICE_GPS', 'REMOTE_WEB']), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), accuracy: z.number().min(0).optional() }), req.body);
  const organization = await Organization.findOne();
  const settings = organization.settings;
  const policy = checkInPolicy(input, req.user, settings);
  if (!policy.allowed) return res.status(policy.status).json({ success: false, message: policy.message });
  const workDate = todayInTimezone(organization.timezone);
  const exists = await Attendance.findOne({ user: req.user._id, workDate });
  if (exists) return res.status(409).json({ success: false, message: 'You already have an attendance record for today.' });
  const record = await Attendance.create({ user: req.user._id, workDate, checkIn: { at: new Date(), method: input.method, location: policy.location }, status: 'IN_PROGRESS' });
  await audit(req, 'ATTENDANCE_CHECK_IN', 'Attendance', record.id, { workDate, method: input.method });
  res.status(201).json({ success: true, message: 'Check-in recorded.', data: { record } });
});

router.post('/attendance/check-out', auth, internal, async (req, res) => {
  const organization = await Organization.findOne();
  const workDate = todayInTimezone(organization.timezone);
  const record = await Attendance.findOne({ user: req.user._id, workDate });
  if (!record) return res.status(404).json({ success: false, message: 'Check in before checking out.' });
  if (record.checkOut) return res.status(409).json({ success: false, message: 'You have already checked out today.' });
  const at = new Date();
  const totalMinutes = Math.max(0, Math.floor((at - record.checkIn.at) / 60000));
  record.checkOut = { at, method: record.checkIn.method };
  record.totalMinutes = totalMinutes;
  record.status = 'COMPLETE';
  await record.save();
  await audit(req, 'ATTENDANCE_CHECK_OUT', 'Attendance', record.id, { workDate, totalMinutes });
  res.json({ success: true, message: 'Check-out recorded.', data: { record } });
});

// Leave requests: HR and the Owner approve directly; no manager approval chain is required.
router.get('/leave-requests/me', auth, internal, async (req, res) => {
  const requests = await LeaveRequest.find({ user: req.user._id }).populate('reviewedBy', 'name').sort({ createdAt: -1 });
  res.json({ success: true, data: { requests } });
});

router.get('/leave-requests', auth, internal, hr, async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const filter = {};
  if (req.query.status && ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(req.query.status)) filter.status = req.query.status;
  const [requests, total] = await Promise.all([
    LeaveRequest.find(filter).populate('user', 'name employeeId department').populate({ path: 'user', populate: { path: 'department', select: 'name' } }).populate('reviewedBy', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit),
    LeaveRequest.countDocuments(filter)
  ]);
  res.json({ success: true, data: { requests }, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

router.post('/leave-requests', auth, internal, async (req, res) => {
  const input = validate(z.object({ leaveType: z.enum(['ANNUAL', 'SICK', 'PERSONAL', 'UNPAID', 'OTHER']), startDate: z.iso.date(), endDate: z.iso.date(), reason: z.string().trim().min(5).max(1000) }), req.body);
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const end = new Date(`${input.endDate}T23:59:59.999Z`);
  if (end < start) return res.status(400).json({ success: false, message: 'End date must be on or after start date.' });
  if (input.startDate < todayInTimezone()) return res.status(400).json({ success: false, message: 'Leave requests must start today or later.' });
  const overlap = await LeaveRequest.exists({ user: req.user._id, status: { $in: ['PENDING', 'APPROVED'] }, startDate: { $lte: end }, endDate: { $gte: start } });
  if (overlap) return res.status(409).json({ success: false, message: 'You already have a pending or approved request covering these dates.' });
  const request = await LeaveRequest.create({ ...input, user: req.user._id, startDate: start, endDate: end });
  await audit(req, 'LEAVE_REQUESTED', 'LeaveRequest', request.id, { startDate: input.startDate, endDate: input.endDate });
  await notifyRole(['HR', 'SUPER_ADMIN'], 'Leave request needs review', `${req.user.name} submitted a ${input.leaveType.toLowerCase()} leave request.`, 'LEAVE', '/leaves');
  res.status(201).json({ success: true, message: 'Leave request sent to HR.', data: { request } });
});

router.post('/leave-requests/:id/review', auth, internal, hr, async (req, res) => {
  const input = validate(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), reviewerNote: z.string().max(1000).optional().default('') }), req.body);
  const request = await LeaveRequest.findById(req.params.id).populate('user', 'name email');
  if (!request) return res.status(404).json({ success: false, message: 'Leave request not found.' });
  if (request.status !== 'PENDING') return res.status(409).json({ success: false, message: 'Only pending requests can be reviewed.' });
  request.status = input.decision;
  request.reviewedBy = req.user._id;
  request.reviewedAt = new Date();
  request.reviewerNote = input.reviewerNote;
  await request.save();
  await audit(req, `LEAVE_${input.decision}`, 'LeaveRequest', request.id, { employee: request.user.id });
  await notify(request.user._id, `Leave ${input.decision.toLowerCase()}`, `Your leave request from ${request.startDate.toISOString().slice(0, 10)} to ${request.endDate.toISOString().slice(0, 10)} was ${input.decision.toLowerCase()}.${input.reviewerNote ? ` Note: ${input.reviewerNote}` : ''}`, input.decision === 'APPROVED' ? 'SUCCESS' : 'WARNING', '/leaves');
  res.json({ success: true, message: `Leave ${input.decision.toLowerCase()}.`, data: { request } });
});

router.post('/leave-requests/:id/cancel', auth, internal, async (req, res) => {
  const request = await LeaveRequest.findOne({ _id: req.params.id, user: req.user._id });
  if (!request) return res.status(404).json({ success: false, message: 'Leave request not found.' });
  if (request.status !== 'PENDING') return res.status(409).json({ success: false, message: 'Only pending requests can be cancelled.' });
  request.status = 'CANCELLED';
  await request.save();
  await audit(req, 'LEAVE_CANCELLED', 'LeaveRequest', request.id);
  res.json({ success: true, message: 'Leave request cancelled.', data: { request } });
});

// Dashboard summaries are scoped to the current user except for HR/Owner views.
router.get('/dashboard', auth, async (req, res) => {
  if (['CLIENT', 'STUDENT'].includes(req.user.role)) return res.json({ success: true, data: { scope: 'portal' } });
  const day = todayInTimezone();
  const isStaff = ['SUPER_ADMIN', 'HR'].includes(req.user.role);
  if (!isStaff) {
    const [today, attendance, leaves, unread] = await Promise.all([
      Attendance.findOne({ user: req.user._id, workDate: day }),
      Attendance.find({ user: req.user._id }).sort({ workDate: -1 }).limit(7),
      LeaveRequest.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(5),
      Notification.countDocuments({ user: req.user._id, readAt: null })
    ]);
    return res.json({ success: true, data: { scope: 'employee', today, attendance, leaves, unread } });
  }
  const [employees, present, pendingLeaves, unread, departments] = await Promise.all([
    User.countDocuments({ active: true, role: { $in: ['HR', 'EMPLOYEE'] } }),
    Attendance.countDocuments({ workDate: day }),
    LeaveRequest.countDocuments({ status: 'PENDING' }),
    Notification.countDocuments({ user: req.user._id, readAt: null }),
    Department.find({ active: true }).select('name').lean()
  ]);
  const headcount = await User.aggregate([
    { $match: { active: true, role: { $in: ['HR', 'EMPLOYEE'] }, department: { $ne: null } } },
    { $group: { _id: '$department', count: { $sum: 1 } } },
    { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'department' } },
    { $unwind: '$department' },
    { $project: { _id: 0, department: '$department.name', count: 1 } },
    { $sort: { count: -1 } }
  ]);
  const recent = await Attendance.find({ workDate: day }).populate('user', 'name employeeId department').populate({ path: 'user', populate: { path: 'department', select: 'name' } }).sort({ 'checkIn.at': -1 }).limit(8);
  res.json({ success: true, data: { scope: req.user.role === 'SUPER_ADMIN' ? 'owner' : 'hr', stats: { employees, present, pendingLeaves, absent: Math.max(0, employees - present), unread }, headcount, departments, recent } });
});

// Notifications and audit history.
router.get('/notifications', auth, async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const [notifications, total, unread] = await Promise.all([
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments({ user: req.user._id }),
    Notification.countDocuments({ user: req.user._id, readAt: null })
  ]);
  res.json({ success: true, data: { notifications, unread }, meta: { page, limit, total } });
});

router.patch('/notifications/read-all', auth, async (req, res) => {
  await Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  res.json({ success: true, message: 'Notifications marked as read.' });
});

router.patch('/notifications/:id/read', auth, async (req, res) => {
  const notification = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { $set: { readAt: new Date() } }, { returnDocument: 'after' });
  if (!notification) return res.status(404).json({ success: false, message: 'Notification not found.' });
  res.json({ success: true, data: { notification } });
});

router.get('/audit-logs', auth, owner, async (req, res) => {
  const { page, limit, skip } = pagination(req);
  const [logs, total] = await Promise.all([
    AuditLog.find().populate('actor', 'name employeeId role').sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments()
  ]);
  res.json({ success: true, data: { logs }, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export default router;
