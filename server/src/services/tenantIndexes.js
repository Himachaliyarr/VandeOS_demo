import AuditLog from '../models/AuditLog.js';
import Attendance from '../models/Attendance.js';
import CrmAutomationRun from '../models/CrmAutomationRun.js';
import CrmConfiguration from '../models/CrmConfiguration.js';
import CrmSavedView from '../models/CrmSavedView.js';
import CrmSyncConflict from '../models/CrmSyncConflict.js';
import CrmSyncLink from '../models/CrmSyncLink.js';
import Department from '../models/Department.js';
import Division from '../models/Division.js';
import LeaveRequest from '../models/LeaveRequest.js';
import Notification from '../models/Notification.js';
import Organization from '../models/Organization.js';
import Shift from '../models/Shift.js';
import User from '../models/User.js';
import WorkspaceRecord from '../models/WorkspaceRecord.js';

const tenantModels = [
  AuditLog, Attendance, CrmAutomationRun, CrmConfiguration, CrmSavedView,
  CrmSyncConflict, CrmSyncLink, Department, Division, LeaveRequest,
  Notification, Organization, Shift, User, WorkspaceRecord
];

export async function ensureTenantIndexes() {
  await Promise.all(tenantModels.map(model => model.createIndexes()));
}
