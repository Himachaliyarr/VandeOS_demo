import AuditLog from '../models/AuditLog.js';

export function audit(req, action, entity, entityId = '', details = {}) {
  return AuditLog.create({
    actor: req.user?._id || null,
    action,
    entity,
    entityId: String(entityId || ''),
    details,
    ipAddress: req.ip || ''
  });
}
