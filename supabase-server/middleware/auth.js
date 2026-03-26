// middleware/auth.js — Supabase version
// Replaces jwt.verify() + User.findById() with:
//   supabase.auth.getUser(token) → fetch profiles row
//
// req.user shape is IDENTICAL to old server:
//   { id, role, email, userName, analysisRequestsUsed, analysisRequestLimit,
//     remainingAnalysisRequests, upgradeRequired }

const supabase = require('../lib/supabase');

const COOKIE_NAME = 'sb-access-token';

function buildUsagePayload(profile) {
  const analysisRequestLimit = Number(profile.analysis_request_limit || 5);
  const analysisRequestsUsed = Number(profile.analysis_requests_used || 0);
  const remainingAnalysisRequests = Math.max(analysisRequestLimit - analysisRequestsUsed, 0);

  return {
    analysisRequestsUsed,
    analysisRequestLimit,
    remainingAnalysisRequests,
    upgradeRequired: remainingAnalysisRequests === 0,
  };
}

async function authMiddleware(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorised' });

  try {
    // Verify JWT via Supabase Auth (replaces jwt.verify())
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authUser) {
      return res.status(401).json({ success: false, message: 'Unauthorised' });
    }

    // Fetch the profiles row (replaces User.findById().select('-password'))
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      return res.status(401).json({ success: false, message: 'Unauthorised' });
    }

    // BLOCK CHECK (identical logic to old middleware/auth.js)
    const now = Date.now();
    if (profile.is_blocked) {
      if (profile.blocked_until) {
        if (new Date(profile.blocked_until).getTime() > now) {
          return res.status(403).json({
            success: false,
            message: `Account blocked until ${new Date(profile.blocked_until).toISOString()}`,
            blockedUntil: profile.blocked_until,
          });
        }
        // Timed block expired: auto-unblock
        await supabase
          .from('profiles')
          .update({ is_blocked: false, blocked_until: null })
          .eq('id', profile.id);
        profile.is_blocked = false;
        profile.blocked_until = null;
      } else {
        return res.status(403).json({
          success: false,
          message: 'Account blocked (indefinite)',
        });
      }
    }

    // Attach minimal user info — SAME SHAPE as old server
    req.user = {
      id: profile.id,
      role: profile.role,
      email: profile.email,
      userName: profile.user_name,
      ...buildUsagePayload(profile),
    };
    req.account = profile; // full profile (replaces req.account = user)
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

module.exports = { authMiddleware, adminOnly, userOnly, COOKIE_NAME };
