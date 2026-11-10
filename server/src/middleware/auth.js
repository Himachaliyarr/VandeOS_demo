import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import TenantRegistry from '../models/TenantRegistry.js';
import { connectionForTenant, runWithTenant } from '../services/tenantContext.js';

export async function authenticate(req, res, next) {
  const token = req.cookies?.vande_session || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ success: false, message: 'Sign in to continue.' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Your session has expired. Sign in again.' });
  }
  const tenantSlug = payload.tenantSlug || 'vande-digital';
  const tenant = await TenantRegistry.findOne({ slug: tenantSlug, status: 'ACTIVE' });
  if (!tenant) return res.status(401).json({ success: false, message: 'This organization is inactive or no longer available.' });

  return runWithTenant(connectionForTenant(tenant), async () => {
    const user = await User.findById(payload.sub).populate('division department shift');
    if (!user || !user.active) return res.status(401).json({ success: false, message: 'This account is inactive or no longer exists.' });
    req.tenant = tenant;
    req.user = user;
    return next();
  });
}

export function allowRoles(...roles) {
  return (req, res, next) => roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ success: false, message: 'You do not have permission to do that.' });
}
