// middleware/auth.js
const jwt = require('jsonwebtoken');
const userRepo = require('../repositories/userRepo');
const WEAK_JWT_SECRETS = new Set(['CLIENT_SECRET_KEY', 'changeme', 'secret', 'jwt_secret']);
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set in environment.');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}
if (JWT_SECRET && WEAK_JWT_SECRETS.has(JWT_SECRET)) {
  console.error('FATAL: JWT_SECRET is a known weak default. Set a strong random secret.');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-insecure-jwt-secret-not-for-production';

function readBearerToken(req) {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  return m ? m[1] : null;
}

function buildUsagePayload(user) {
  const analysisRequestLimit = Number(user.analysisRequestLimit || 5);
  const analysisRequestsUsed = Number(user.analysisRequestsUsed || 0);
  const remainingAnalysisRequests = Math.max(analysisRequestLimit - analysisRequestsUsed, 0);

  return {
    analysisRequestsUsed,
    analysisRequestLimit,
    remainingAnalysisRequests,
    upgradeRequired: remainingAnalysisRequests === 0,
  };
}

async function authMiddleware(req, res, next) {
  const bearerToken = readBearerToken(req);
  const cookieToken = req.cookies?.token || null;
  const tokenCandidates = [bearerToken, cookieToken].filter(Boolean);
  if (tokenCandidates.length === 0) return res.status(401).json({ success: false, message: 'Unauthorised' });

  let decoded = null;
  let lastErr = null;
  for (const t of tokenCandidates) {
    try {
      decoded = jwt.verify(t, EFFECTIVE_JWT_SECRET);
      if (decoded) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!decoded) {
    console.error('JWT or authMiddleware error:', lastErr?.message || 'Invalid token');
    return res.status(401).json({ success: false, message: 'Unauthorised' });
  }

  try {
    // Load the fresh user from DB (so we can check isBlocked / blockedUntil)
    const user = await userRepo.findById(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorised' });

    // BLOCK CHECK: deny active blocks (timed or indefinite)
    const now = Date.now();
    if (user.isBlocked) {
      if (user.blockedUntil) {
        if (new Date(user.blockedUntil).getTime() > now) {
          return res.status(403).json({
            success: false,
            message: `Account blocked until ${user.blockedUntil.toISOString()}`,
            blockedUntil: user.blockedUntil,
          });
        }
        await userRepo.updateUserDoc(user.id, { isBlocked: false, blockedUntil: null });
      } else {
        return res.status(403).json({
          success: false,
          message: 'Account blocked (indefinite)',
        });
      }
    }

    // attach minimal user info
    req.user = {
      id: user.id,
      role: user.role,
      email: user.email,
      userName: user.userName,
      ...buildUsagePayload(user),
    };
    req.account = user;
    return next();
  } catch (err) {
    console.error('authMiddleware error:', err.message || err);
    return res.status(401).json({ success: false, message: 'Unauthorised' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorised' });
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
  next();
}

function userOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorised' });
  if (req.user.role !== 'user') return res.status(403).json({ success: false, message: 'Forbidden' });
  next();
}

module.exports = { authMiddleware, adminOnly, userOnly };
