import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { requestCorrelation } from './middleware/requestCorrelation.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { validateEnvironment } from './config/envValidation.js';
import healthRouter from './routes/healthRoutes.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import requestsRouter from './routes/requests.js';
import inventoryRouter from './routes/inventoryRoutes.js';
import peerTransferRouter from './routes/peerTransferRoutes.js';
import peerTransferAcceptanceRouter from './routes/peerTransferAcceptanceRoutes.js';
import donorEligibilityRouter from './routes/donorEligibilityRoutes.js';
import donorRankingRouter from './routes/donorRankingRoutes.js';
import donorDispatchRouter from './routes/donorDispatchRoutes.js';
import notificationRouter from './routes/notificationRoutes.js';
import devAuthRouter from './routes/devAuthRoutes.js';
import authRouter from './routes/authRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Safe startup environment validation
validateEnvironment();

const app = express();

app.disable('x-powered-by');

// 1. Core security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// 2. Request correlation and structured logging (early in stack to cover all responses)
app.use(requestCorrelation);

// 3. Hardened CORS configuration: production strictly allows only explicit LIFE-LINK domains
const productionOrigins = [
  'https://life-link.in',
  'https://www.life-link.in',
  'https://life-link-ai-powered-emergency-medi.vercel.app'
];

const developmentOrigins = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173'
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const configuredFrontend = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : null;
    const allowed = new Set(productionOrigins);
    if (configuredFrontend) allowed.add(configuredFrontend);

    const isProd = process.env.NODE_ENV === 'production';

    if (isProd) {
      if (allowed.has(origin)) {
        return callback(null, true);
      }
      const err = new Error(`CORS blocked for origin: ${origin}`);
      err.status = 403;
      err.code = 'CORS_FORBIDDEN';
      return callback(err);
    }

    // In development / local testing: allow configured, known dev origins, or local hosts
    if (allowed.has(origin) || developmentOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '100kb' }));

// 4. Health, Liveness & Readiness probes
app.use('/api', healthRouter);
app.use('/', healthRouter);

// 5. Auth and Business Routes
app.use('/api', devAuthRouter);
app.use('/api', authRouter);

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user, organization: req.organization });
});

app.use('/api/requests', requestsRouter);
app.use('/api', inventoryRouter);
app.use('/api', peerTransferRouter);
app.use('/api', peerTransferAcceptanceRouter);
app.use('/api', donorEligibilityRouter);
app.use('/api', donorRankingRouter);
app.use('/api', donorDispatchRouter);
app.use('/api', notificationRouter);

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

// 6. Unknown route fallback & centralized error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
