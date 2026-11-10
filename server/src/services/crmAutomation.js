import CrmAutomationRun from '../models/CrmAutomationRun.js';
import CrmConfiguration from '../models/CrmConfiguration.js';
import WorkspaceRecord from '../models/WorkspaceRecord.js';
import { notify } from './notifications.js';
import { sendCrmEmail } from './crmMailer.js';

function renderTemplate(value, record) {
  const data = record.data instanceof Map ? Object.fromEntries(record.data) : record.data || {};
  return String(value || '').replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_match, key) => {
    if (key === 'title') return record.title || '';
    if (key === 'status') return record.status || '';
    return data[key] || '';
  });
}

async function notifyByTemplate(configuration, automation, record) {
  const user = record.assignedTo || record.createdBy;
  const template = configuration.emailTemplates.find(item => item.name === automation.templateName);
  const message = template?.kind === 'ACTIVITY'
    ? renderTemplate(template.body, record)
    : `Follow up with ${record.title}.`;
  if (user) await notify(user, automation.name, message, 'INFO', '/crm');
  if (template?.kind === 'EMAIL') {
    const data = record.data instanceof Map ? Object.fromEntries(record.data) : record.data || {};
    const to = data.email;
    if (!to) throw new Error(`CRM email automation "${automation.name}" skipped: record "${record.title}" has no email field.`);
    await sendCrmEmail({
      to,
      subject: renderTemplate(template.subject || automation.name, record),
      text: renderTemplate(template.body, record)
    });
  }
}

export async function runCrmFollowUpAutomations() {
  const configuration = await CrmConfiguration.findOne({ key: 'organization' });
  if (!configuration) return;
  const automations = configuration.automations.filter(item => item.enabled && item.trigger === 'FOLLOW_UP_DUE');
  if (!automations.length) return;
  const records = await WorkspaceRecord.find({
    module: 'crm',
    archivedAt: null,
    dueDate: { $lte: new Date() },
    status: { $nin: ['DONE', 'WON', 'LOST', 'CANCELLED', 'INACTIVE'] }
  }).populate('createdBy assignedTo', 'email name').limit(1000);
  const day = new Date().toISOString().slice(0, 10);
  for (const automation of automations) {
    for (const record of records) {
      if (automation.stage && automation.stage !== record.status) continue;
      const runKey = `${record.id}:${automation._id || automation.name}:${day}`;
      try {
        await CrmAutomationRun.create({ record: record._id, automation: automation.name, runKey });
      } catch (error) {
        if (error?.code === 11000) continue;
        throw error;
      }
      try {
        await notifyByTemplate(configuration, automation, record);
      } catch (error) {
        console.error(`CRM automation failed for record ${record.id}:`, error.message);
      }
    }
  }
}

export async function runCrmStageAutomations(record, previousStatus) {
  if (previousStatus === record.status) return;
  const configuration = await CrmConfiguration.findOne({ key: 'organization' });
  if (!configuration) return;
  for (const automation of configuration.automations) {
    if (!automation.enabled || automation.trigger !== 'STAGE_CHANGED' || (automation.stage && automation.stage !== record.status)) continue;
    try {
      const runKey = `${record.id}:${automation._id || automation.name}:${record.updatedAt.toISOString()}`;
      try {
        await CrmAutomationRun.create({ record: record._id, automation: automation.name, runKey });
      } catch (error) {
        if (error?.code === 11000) continue;
        throw error;
      }
      const template = configuration.emailTemplates.find(item => item.name === automation.templateName && item.kind === 'ACTIVITY');
      const title = renderTemplate(template?.subject || automation.name, record).slice(0, 180);
      try {
        await WorkspaceRecord.create({
          module: 'crm',
          kind: 'activity',
          title: `${title}: ${record.title}`.slice(0, 180),
          description: renderTemplate(template?.body || `Follow up after ${record.title} moved to ${record.status}.`, record),
          status: 'OPEN',
          assignedTo: record.assignedTo || record.createdBy,
          parent: record._id,
          dueDate: new Date(Date.now() + (automation.delayDays || 0) * 86400000),
          data: { automationName: automation.name, sourceRecordId: String(record._id) },
          createdBy: record.createdBy
        });
      } catch (error) {
        await CrmAutomationRun.deleteOne({ runKey });
        throw error;
      }
      await notifyByTemplate(configuration, automation, record);
    } catch (error) {
      console.error(`CRM stage automation failed for record ${record.id}:`, error.message);
    }
  }
}
