import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, requireRole } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Public health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LIFE-LINK API',
    version: '1.0.0',
    authProvider: 'Supabase Auth'
  });
});

// Authenticated identity endpoint
// Resolves public.users record and organization membership
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    organization: req.organization
  });
});

// Role-guarded test endpoints
app.get('/api/donor/ping', requireAuth, requireRole('DONOR'), (req, res) => {
  res.json({
    message: 'Authorized: DONOR access verified',
    userId: req.user.id,
    role: req.user.role
  });
});

app.get('/api/hospital/ping', requireAuth, requireRole('HOSPITAL'), (req, res) => {
  res.json({
    message: 'Authorized: HOSPITAL access verified',
    userId: req.user.id,
    role: req.user.role,
    organization: req.organization
  });
});

app.get('/api/blood-bank/ping', requireAuth, requireRole('BLOOD_BANK'), (req, res) => {
  res.json({
    message: 'Authorized: BLOOD_BANK access verified',
    userId: req.user.id,
    role: req.user.role,
    organization: req.organization
  });
});

app.get('/api/admin/ping', requireAuth, requireRole('ADMIN'), (req, res) => {
  res.json({
    message: 'Authorized: ADMIN access verified',
    userId: req.user.id,
    role: req.user.role
  });
});

// Start server if not imported
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`LIFE-LINK Backend running on port ${port}`);
  });
}

export default app;
