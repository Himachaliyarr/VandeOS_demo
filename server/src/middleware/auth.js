import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export async function authenticate(req, res, next) {
  const token = req.cookies?.vande_session || req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ success: false, message: 'Sign in to continue.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).populate('division department shift');
    if (!user || !user.active) return res.status(401).json({ success: false, message: 'This account is inactive or no longer exists.' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Your session has expired. Sign in again.' });
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ success: false, message: 'You do not have permission to do that.' });
}
