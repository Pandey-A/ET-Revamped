// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User'); // make sure path is correct
const JWT_SECRET = process.env.JWT_SECRET || 'CLIENT_SECRET_KEY';

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
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorised' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Load the fresh user from DB (so we can check isBlocked / blockedUntil)
    const user = await User.findById(decoded.id).select('-password');

    // after: const user = await User.findById(decoded.id).select('-password');
if (!user) return res.status(401).json({ success: false, message: 'Unauthorised' });

// BLOCK CHECK: deny active blocks (timed or indefinite)
const now = Date.now();
if (user.isBlocked) {
  if (user.blockedUntil) {
    // timed block still active?
    if (new Date(user.blockedUntil).getTime() > now) {
      return res.status(403).json({
        success: false,
        message: `Account blocked until ${user.blockedUntil.toISOString()}`,
        blockedUntil: user.blockedUntil
      });
    }
    // timed block expired: auto-unblock
    user.isBlocked = false;
    user.blockedUntil = null;
    await user.save();
  } else {
    // indefinite block -> reject
    return res.status(403).json({
      success: false,
      message: 'Account blocked (indefinite)'
    });
  }
}


    // attach minimal user info
    req.user = {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
      userName: user.userName,
      ...buildUsagePayload(user),
    };
    req.account = user;
    return next();
  } catch (err) {
    console.error('JWT or authMiddleware error:', err.message || err);
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
