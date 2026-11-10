import mongoose from 'mongoose';
import { tenantModel } from '../services/tenantContext.js';

const fieldSchema = new mongoose.Schema({
  key: { type: String, required: true, match: /^[A-Za-z][A-Za-z0-9_]{0,79}$/ },
  label: { type: String, required: true, trim: true, maxlength: 80 },
  type: { type: String, enum: ['TEXT', 'NUMBER', 'DATE', 'SELECT'], default: 'TEXT' },
  options: { type: [String], default: [] },
  required: { type: Boolean, default: false },
  kinds: { type: [String], default: [] }
}, { _id: false });

const rolePermissionSchema = new mongoose.Schema({
  view: { type: Boolean, default: false },
  edit: { type: Boolean, default: false },
  export: { type: Boolean, default: false },
  assign: { type: Boolean, default: false }
}, { _id: false });

const crmConfigurationSchema = new mongoose.Schema({
  key: { type: String, default: 'organization', unique: true },
  pipelines: {
    type: Map,
    of: [{ type: String, trim: true, maxlength: 40 }],
    default: {
      lead: ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'],
      client: ['ACTIVE', 'INACTIVE'],
      contact: ['ACTIVE', 'INACTIVE'],
      deal: ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'],
      activity: ['OPEN', 'DONE']
    }
  },
  fields: {
    type: [fieldSchema],
    default: [
      { key: 'company', label: 'Company' },
      { key: 'contactName', label: 'Contact name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'source', label: 'Lead source' },
      { key: 'industry', label: 'Industry' }
    ]
  },
  recordTypes: { type: [String], default: ['lead', 'client', 'contact', 'deal', 'activity'] },
  currency: { type: String, default: 'INR', match: /^[A-Z]{3}$/ },
  dateFormat: { type: String, enum: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'], default: 'DD/MM/YYYY' },
  scoringRules: {
    type: [{
      field: { type: String, required: true },
      operator: { type: String, enum: ['equals', 'contains', 'present'], default: 'present' },
      value: { type: String, default: '' },
      points: { type: Number, min: 0, max: 100, default: 0 }
    }],
    default: []
  },
  permissions: {
    type: Map,
    of: rolePermissionSchema,
    default: {
      HR: { view: true, edit: true, export: true, assign: true },
      EMPLOYEE: { view: true, edit: true, export: false, assign: false },
      CLIENT: { view: true, edit: false, export: false, assign: false }
    }
  },
  emailTemplates: {
    type: [{
      name: { type: String, required: true, trim: true, maxlength: 80 },
      subject: { type: String, trim: true, maxlength: 200, default: '' },
      body: { type: String, required: true, maxlength: 5000 },
      kind: { type: String, enum: ['EMAIL', 'ACTIVITY'], default: 'EMAIL' }
    }],
    default: []
  },
  automations: {
    type: [{
      name: { type: String, required: true, trim: true, maxlength: 80 },
      trigger: { type: String, enum: ['FOLLOW_UP_DUE', 'STAGE_CHANGED'], required: true },
      enabled: { type: Boolean, default: true },
      stage: { type: String, default: '' },
      templateName: { type: String, default: '' },
      delayDays: { type: Number, min: 0, max: 365, default: 1 }
    }],
    default: []
  },
  salesforce: {
    enabled: { type: Boolean, default: false },
    refreshTokenEncrypted: { type: String, default: '' },
    instanceUrl: { type: String, default: '' },
    lastSyncAt: { type: Date, default: null },
    lastSyncError: { type: String, default: '' },
    oauthState: { type: String, default: '' },
    oauthStateExpiresAt: { type: Date, default: null }
  }
}, { timestamps: true });

export default tenantModel('CrmConfiguration', crmConfigurationSchema);
