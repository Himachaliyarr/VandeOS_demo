import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes/index.js';
import { notFound, errorHandler } from './middleware/errors.js';
import workspaceRouter from './routes/workspace.js';

const app = express();
const clientDist = resolve(fileURLToPath(new URL('../../client/dist', import.meta.url)));
const apiEndpoints = [
  'GET /api/health',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'GET /api/auth/me',
  'POST /api/auth/change-password',
  'GET /api/organization',
  'PATCH /api/organization/settings',
  'GET /api/divisions',
  'POST /api/divisions',
  'PATCH /api/divisions/:id',
  'GET /api/departments',
  'POST /api/departments',
  'PATCH /api/departments/:id',
  'GET /api/employees/me',
  'GET /api/employees',
  'POST /api/employees',
  'PATCH /api/employees/:id',
  'POST /api/employees/:id/deactivate',
  'GET /api/shifts',
  'POST /api/shifts',
  'PATCH /api/shifts/:id',
  'GET /api/attendance/me',
  'GET /api/attendance',
  'POST /api/attendance/check-in',
  'POST /api/attendance/check-out',
  'GET /api/leave-requests/me',
  'GET /api/leave-requests',
  'POST /api/leave-requests',
  'POST /api/leave-requests/:id/review',
  'POST /api/leave-requests/:id/cancel',
  'GET /api/dashboard',
  'GET /api/notifications',
  'PATCH /api/notifications/read-all',
  'PATCH /api/notifications/:id/read',
  'GET /api/audit-logs',
  'GET /api/workspace/meta',
  'GET /api/workspace/reports/overview',
  'GET /api/workspace/:module',
  'POST /api/workspace/:module',
  'POST /api/workspace/finance/:id/payments',
  'POST /api/workspace/inventory/:id/movements',
  'POST /api/workspace/academy/:id/review',
  'PATCH /api/workspace/:module/:id',
  'POST /api/workspace/:module/:id/archive',
  'GET /api/workspace/:module/:id'
];
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api', apiRouter);
app.use('/api/workspace', workspaceRouter);
if (process.env.NODE_ENV === 'production' && existsSync(resolve(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false, maxAge: '1d', immutable: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path === '/api' || !req.accepts('html')) return next();
    return res.sendFile(resolve(clientDist, 'index.html'));
  });
}
app.get('/', (_req, res) => res.json({
  success: true,
  service: 'vande-os-api',
  endpoints: apiEndpoints
}));
app.use(notFound);
app.use(errorHandler);

export default app;
