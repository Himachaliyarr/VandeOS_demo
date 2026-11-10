import test from 'node:test';
import assert from 'node:assert/strict';
import CrmConfiguration from '../src/models/CrmConfiguration.js';
import CrmSavedView from '../src/models/CrmSavedView.js';
import {
  calculateLeadScore,
  crmConfigurationResponse,
  crmRolePermission,
  validateCrmFields
} from '../src/services/crmConfiguration.js';

test('CRM configuration defaults serialize pipelines and permissions for the API', async () => {
  const configuration = new CrmConfiguration();
  await configuration.validate();

  const response = crmConfigurationResponse(configuration);
  assert.deepEqual(response.pipelines.lead, ['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST']);
  assert.equal(response.permissions.EMPLOYEE.export, false);
  assert.equal(response.salesforce.connected, false);
  assert.equal(Object.hasOwn(response.salesforce, 'refreshTokenEncrypted'), false);
  const employeePermissions = crmRolePermission(configuration, 'EMPLOYEE');
  assert.equal(employeePermissions.view, true);
  assert.equal(employeePermissions.edit, true);
  assert.equal(employeePermissions.export, false);
  assert.equal(employeePermissions.assign, false);
  assert.deepEqual(crmRolePermission(configuration, 'SUPER_ADMIN'), {
    view: true,
    edit: true,
    export: true,
    assign: true
  });
});

test('CRM custom field validation enforces required, numeric, date, and select values', () => {
  const configuration = {
    fields: [
      { key: 'budget', label: 'Budget', type: 'NUMBER', required: true, kinds: ['lead'] },
      { key: 'startDate', label: 'Start date', type: 'DATE', required: false, kinds: [] },
      { key: 'source', label: 'Source', type: 'SELECT', options: ['Website', 'Referral'], required: false, kinds: [] }
    ]
  };

  assert.equal(validateCrmFields({ kind: 'lead', data: { budget: '2500' } }, configuration).kind, 'lead');
  assert.throws(() => validateCrmFields({ kind: 'lead', data: {} }, configuration), /Budget is required/);
  assert.throws(() => validateCrmFields({ kind: 'lead', data: { budget: 'many' } }, configuration), /Budget must be a number/);
  assert.equal(validateCrmFields({ kind: 'contact', data: {} }, configuration).kind, 'contact');
  assert.throws(() => validateCrmFields({ kind: 'lead', data: { budget: '1', startDate: 'not-a-date' } }, configuration), /Start date must be a valid date/);
  assert.throws(() => validateCrmFields({ kind: 'lead', data: { budget: '1', source: 'Unknown' } }, configuration), /Source must be one of the configured options/);
});

test('CRM lead scoring supports present, equality, and contains rules', () => {
  const score = calculateLeadScore(
    { data: { source: 'Website referral', industry: 'Education', company: '' } },
    { scoringRules: [
      { field: 'source', operator: 'contains', value: 'web', points: 15 },
      { field: 'industry', operator: 'equals', value: 'education', points: 20 },
      { field: 'company', operator: 'present', points: 10 }
    ] }
  );
  assert.equal(score, 35);
});

test('saved views default to private table views and retain search filters', async () => {
  const view = new CrmSavedView({
    name: 'My overdue leads',
    owner: '507f1f77bcf86cd799439011',
    filters: { kind: 'lead', search: 'Northwind', overdue: true }
  });
  await view.validate();
  assert.equal(view.shared, false);
  assert.equal(view.layout, 'TABLE');
  assert.equal(view.filters.search, 'Northwind');
  assert.equal(view.filters.overdue, true);
});

test('CRM stage automation delay defaults to one day and rejects values outside bounds', async () => {
  const configuration = new CrmConfiguration({
    automations: [{ name: 'Create follow-up', trigger: 'STAGE_CHANGED' }]
  });
  assert.equal(configuration.automations[0].delayDays, 1);
  await configuration.validate();

  configuration.automations[0].delayDays = 366;
  await assert.rejects(configuration.validate(), /delayDays/i);
});
