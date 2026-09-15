import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, requireRole } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Support loading .env from backend directory or root
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const port = process.env.PORT || 5000;

// Security: Disable X-Powered-By header
app.disable('x-powered-by');

// Security: Enforce basic defense-in-depth headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Production-hardened CORS configuration
const allowedOrigins = [
  'https://life-link-ai-powered-emergency-medi.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL.replace(/\/$/, ''));
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (curl, server-to-server reverse proxy, health checks)
    if (!origin) return callback(null, true);

    const isExplicitlyAllowed = allowedOrigins.includes(origin);
    const isVercelPreview = /\.vercel\.app$/.test(new URL(origin).hostname);

    if (isExplicitlyAllowed || isVercelPreview || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());

// Public health check for Railway/Render probes
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
let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(port, () => {
    console.log(`LIFE-LINK Backend running on port ${port} [${process.env.NODE_ENV || 'development'}]`);
  });
}

// Graceful termination handling for container lifecycle
const handleShutdown = (signal) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export default app;
