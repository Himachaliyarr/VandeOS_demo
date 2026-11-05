import Notification from '../models/Notification.js';
import User from '../models/User.js';

export async function notify(user, title, message, type = 'INFO', href = '') {
  if (!user) return null;
  return Notification.create({ user, title, message, type, href });
}

export async function notifyRole(roles, title, message, type = 'INFO', href = '') {
  const users = await User.find({ role: { $in: roles }, active: true }).select('_id');
  if (!users.length) return [];
  return Notification.insertMany(users.map(({ _id }) => ({ user: _id, title, message, type, href })));
}
