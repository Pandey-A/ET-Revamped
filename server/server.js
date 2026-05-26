// server.js (or app.js)
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const { query } = require('./db/pool');
const auth = require('./routers/auth-route');
const adminRoute = require('./routers/admin');
const uploadRoute = require('./routers/upload');
const agentsRoute = require('./routers/agents');
const { createRateLimiter } = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set in .env (PostgreSQL connection string)');
  process.exit(1);
}
app.use(helmet({
  crossOriginResourcePolicy: false,
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const globalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  prefix: 'global',
  message: 'Too many API requests from this client. Please slow down.',
});

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  prefix: 'auth',
  message: 'Too many authentication attempts. Please try again later.',
});

// CORS: allowlisted env origins (production) + browser dev on localhost / 127.0.0.1 / ::1 (any port).
// Optional: CORS_EXTRA_ORIGINS=comma list (e.g. http://192.168.1.5:3000 for LAN device testing).
function parseOriginList(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function isLocalBrowserDevOrigin(origin) {
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') {
      return false;
    }
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const envAllowedOrigins = new Set([
  ...parseOriginList(process.env.CORS_ORIGINS),
  ...parseOriginList(process.env.CORS_EXTRA_ORIGINS),
  // Sensible defaults when CORS_ORIGINS is unset (local dev + production site for this project)
  ...(process.env.CORS_ORIGINS
    ? []
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:5173',
        'https://elevatetrust.in',
        'https://www.elevatetrust.in',
      ]),
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (envAllowedOrigins.has(origin)) {
        return callback(null, true);
      }
      if (isLocalBrowserDevOrigin(origin)) {
        return callback(null, true);
      }
      console.warn('[CORS] blocked origin:', origin);
      return callback(null, false);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  }),
);

app.use('/api', globalLimiter);
app.use('/api/auth', authLimiter, auth);
app.use('/api/admin', adminRoute);
app.use('/api', agentsRoute);
app.use('/api', uploadRoute);

// example protected admin route
app.get('/api/admin/data', require('./middleware/auth').authMiddleware, require('./middleware/auth').adminOnly, (req, res) => {
  res.json({ secret: 'admin only data' });
});

query('SELECT 1')
  .then(() => {
    console.log('PostgreSQL connected');
    app.listen(PORT, () => console.log('server running on', PORT));
  })
  .catch((err) => {
    console.error('PostgreSQL connection failed:', err.message || err);
    process.exit(1);
  });
