// routers/auth-route.js — Supabase version
// Identical route paths, middleware chain, and rate limiter configs.

const express = require('express');
const {
  registerUser, loginUser, logoutUser, checkAuth,
  verifyEmail, resendVerificationEmail,
  forgotPassword, verifyOtp, resetPassword,
} = require('../controller/controller');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { createRateLimiter, getDeviceFingerprint } = require('../middleware/security');
const { validateBody } = require('../middleware/validate');
const {
  registerSchema, loginSchema, verifyEmailSchema, resendVerificationSchema,
  forgotPasswordSchema, verifyOtpSchema, resetPasswordSchema,
} = require('../schemas/authSchemas');

const router = express.Router();

const otpRequestLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 3,
  prefix: 'otp-request-device',
  code: 'OTP_REQUEST_LIMIT_REACHED',
  message: 'Too many OTP requests from this device. Please wait before trying again.',
  keyGenerator: (req, prefix) => {
    const email = String(req.body?.email || '').trim().toLowerCase() || 'unknown';
    const device = getDeviceFingerprint(req);
    return `${prefix}:email:${email}:device:${device}`;
  },
});

const otpVerifyLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 8,
  prefix: 'otp-verify-device',
  code: 'OTP_VERIFY_LIMIT_REACHED',
  message: 'Too many OTP verification attempts from this device. Please wait and retry.',
  keyGenerator: (req, prefix) => {
    const email = String(req.body?.email || '').trim().toLowerCase() || 'unknown';
    const device = getDeviceFingerprint(req);
    return `${prefix}:email:${email}:device:${device}`;
  },
});

router.post('/register', validateBody(registerSchema), registerUser);
router.post('/login', validateBody(loginSchema), loginUser);
router.post('/logout', logoutUser);
router.get('/check-auth', authMiddleware, checkAuth);
router.post('/verify-email', validateBody(verifyEmailSchema), verifyEmail);
router.post('/resend-verification-email', validateBody(resendVerificationSchema), otpRequestLimiter, resendVerificationEmail);
router.post('/forgot-password', validateBody(forgotPasswordSchema), otpRequestLimiter, forgotPassword);
router.post('/verify-otp', validateBody(verifyOtpSchema), otpVerifyLimiter, verifyOtp);
router.post('/reset-password', validateBody(resetPasswordSchema), resetPassword);

// Admin-only: promote user (same inline route as old server)
router.post('/promote/:id', authMiddleware, adminOnly, async (req, res) => {
  const supabase = require('../lib/supabase');
  try {
    const { data: user, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await supabase
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', req.params.id);

    return res.json({ success: true, message: 'Promoted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
