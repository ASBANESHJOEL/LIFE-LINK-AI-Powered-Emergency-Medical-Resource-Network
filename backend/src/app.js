import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, requireRole } from './middleware/auth.js';
import requestsRouter from './routes/requests.js';
import inventoryRouter from './routes/inventoryRoutes.js';
import peerTransferRouter from './routes/peerTransferRoutes.js';
import peerTransferAcceptanceRouter from './routes/peerTransferAcceptanceRoutes.js';
import donorEligibilityRouter from './routes/donorEligibilityRoutes.js';
import donorRankingRouter from './routes/donorRankingRoutes.js';
import donorDispatchRouter from './routes/donorDispatchRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

const allowedOrigins = [
  'https://life-link.in',
  'https://www.life-link.in',
  'https://life-link-ai-powered-emergency-medi.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL.replace(/\/$/, ''));

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isExplicitlyAllowed = allowedOrigins.includes(origin);
    const isVercelPreview = /\.vercel\.app$/.test(new URL(origin).hostname);
    if (isExplicitlyAllowed || isVercelPreview || process.env.NODE_ENV !== 'production') callback(null, true);
    else callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LIFE-LINK API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    authProvider: 'Supabase Auth',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user, organization: req.organization });
});

app.post('/api/requests', requireAuth, requireRole('HOSPITAL'), requestsRouter);
app.use('/api', inventoryRouter);
app.use('/api', peerTransferRouter);
app.use('/api', peerTransferAcceptanceRouter);
app.use('/api', donorEligibilityRouter);
app.use('/api', donorRankingRouter);
app.use('/api', donorDispatchRouter);

app.get('/api/donor/ping', requireAuth, requireRole('DONOR'), (req, res) => {
  res.json({ message: 'Authorized: DONOR access verified', userId: req.user.id, role: req.user.role });
});

app.get('/api/hospital/ping', requireAuth, requireRole('HOSPITAL'), (req, res) => {
  res.json({ message: 'Authorized: HOSPITAL access verified', userId: req.user.id, role: req.user.role, organization: req.organization });
});

app.get('/api/blood-bank/ping', requireAuth, requireRole('BLOOD_BANK'), (req, res) => {
  res.json({ message: 'Authorized: BLOOD_BANK access verified', userId: req.user.id, role: req.user.role, organization: req.organization });
});

app.get('/api/admin/ping', requireAuth, requireRole('ADMIN'), (req, res) => {
  res.json({ message: 'Authorized: ADMIN access verified', userId: req.user.id, role: req.user.role });
});

export default app;
