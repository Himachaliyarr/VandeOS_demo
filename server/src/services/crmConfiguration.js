import CrmConfiguration from '../models/CrmConfiguration.js';

export async function getCrmConfiguration() {
  let configuration = await CrmConfiguration.findOne({ key: 'organization' });
  if (!configuration) configuration = await CrmConfiguration.create({ key: 'organization' });
  return configuration;
}

export function crmConfigurationResponse(configuration) {
  const value = configuration.toObject();
  if (value.permissions instanceof Map) value.permissions = Object.fromEntries(value.permissions);
  if (value.pipelines instanceof Map) value.pipelines = Object.fromEntries(value.pipelines);
  return {
    ...value,
    salesforce: {
      connected: Boolean(value.salesforce?.refreshTokenEncrypted),
      lastSyncAt: value.salesforce?.lastSyncAt || null,
      lastSyncError: value.salesforce?.lastSyncError || ''
    }
  };
}

export function crmRolePermission(configuration, role) {
  if (role === 'SUPER_ADMIN') return { view: true, edit: true, export: true, assign: true };
  const permissions = configuration.permissions instanceof Map
    ? configuration.permissions.get(role)
    : configuration.permissions?.[role];
  return permissions || { view: false, edit: false, export: false, assign: false };
}

export function validateCrmFields(input, configuration, { partial = false } = {}) {
  const data = input.data || {};
  const fields = configuration.fields || [];
  for (const field of fields) {
    if (field.kinds?.length && !field.kinds.includes(input.kind)) continue;
    const value = data[field.key];
    if (!partial && field.required && (value === undefined || value === '')) {
      throw Object.assign(new Error(`${field.label} is required.`), { status: 400 });
    }
    if (value === undefined || value === '') continue;
    if (field.type === 'NUMBER' && !Number.isFinite(Number(value))) {
      throw Object.assign(new Error(`${field.label} must be a number.`), { status: 400 });
    }
    if (field.type === 'DATE' && Number.isNaN(Date.parse(value))) {
      throw Object.assign(new Error(`${field.label} must be a valid date.`), { status: 400 });
    }
    if (field.type === 'SELECT' && !field.options.includes(value)) {
      throw Object.assign(new Error(`${field.label} must be one of the configured options.`), { status: 400 });
    }
  }
  return input;
}

export function calculateLeadScore(record, configuration) {
  const data = record.data instanceof Map ? Object.fromEntries(record.data) : record.data || {};
  return (configuration.scoringRules || []).reduce((score, rule) => {
    const value = data[rule.field];
    const matches = rule.operator === 'present'
      ? Boolean(value)
      : rule.operator === 'equals'
        ? String(value || '').toLowerCase() === String(rule.value).toLowerCase()
        : String(value || '').toLowerCase().includes(String(rule.value).toLowerCase());
    return score + (matches ? rule.points : 0);
  }, 0);
}
