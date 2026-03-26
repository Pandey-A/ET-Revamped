// server.js — Supabase-backed Express server
// Drop-in replacement for the old server/server.js
// Same route mounts, same rate limiters, same CORS config.

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Ensure Supabase client initialises (will exit on bad config)
require('./lib/supabase');

const auth = require('./routers/auth-route');
const adminRoute = require('./routers/admin');
const uploadRoute = require('./routers/upload');
const { createRateLimiter } = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: false,
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ── Rate limiters (identical to old server) ──────────────────
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

const analysisApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  prefix: 'analysis-api',
  message: 'Too many analysis requests. Please wait and retry.',
});

// ── CORS (identical to old server) ───────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// ── Routes (same paths as old server) ────────────────────────
app.use('/api', globalLimiter);
app.use('/api/auth', authLimiter, auth);
app.use('/api/admin', adminRoute);
app.use('/api', analysisApiLimiter, uploadRoute);

// protected admin data route (same as old server)
app.get(
  '/api/admin/data',
  require('./middleware/auth').authMiddleware,
  require('./middleware/auth').adminOnly,
  (req, res) => res.json({ secret: 'admin only data' })
);

app.listen(PORT, () => console.log(`supabase-server running on port ${PORT}`));
