// controller/controller.js — Supabase version
// All 9 auth functions rewritten to use Supabase Auth + Postgres (profiles table).
// Response shapes, error messages, cookie names, and email templates are IDENTICAL to old server.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const supabase = require('../lib/supabase');
const { COOKIE_NAME } = require('../middleware/auth');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.resend.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || 'resend';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || SMTP_PORT === 465;
const EMAIL_FROM = process.env.EMAIL_FROM || '';

let cachedTransporter = null;

// ── Helpers ───────────────────────────────────────────────────

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

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function assertMailConfig() {
  if (!SMTP_PASS) throw new Error('SMTP_PASS is missing. Configure Resend SMTP password in .env');
  if (!EMAIL_FROM) throw new Error('EMAIL_FROM is missing. Configure a verified sender in .env');
}

function createTransporter() {
  assertMailConfig();
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return cachedTransporter;
}

function createShortVerificationToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// ── Email: verification (identical template to old server) ────
async function sendEmailVerificationMail(profile) {
  const verificationToken = createShortVerificationToken();
  const tokenHash = hashToken(verificationToken);
  const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('profiles')
    .update({
      email_verification_token_hash: tokenHash,
      email_verification_token_expiry: tokenExpiry,
    })
    .eq('id', profile.id);

  if (error) throw error;

  const verifyUrl = `${FRONTEND_URL}/v/${encodeURIComponent(verificationToken)}`;
  const displayName = profile?.user_name ? String(profile.user_name) : 'User';

  const verifyEmailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Email Verification</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>

<body style="margin:0; padding:0; background-color:#f4f6f8; font-family: Arial, sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 20px;">
    <tr>
      <td align="center">
        <table width="500" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:10px; padding:30px; box-shadow:0 4px 12px rgba(0,0,0,0.05);">
          <tr>
            <td align="center" style="padding-bottom:20px;">
              <h2 style="margin:0; color:#333;">Verify Your Email</h2>
            </td>
          </tr>

          <tr>
            <td style="color:#555; font-size:16px; line-height:1.6;">
              <p>Hello ${displayName},</p>
              <p>
                Thanks for signing up! Please confirm your email address by clicking the button below.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:25px 0;">
              <a href="${verifyUrl}"
                 style="background-color:#4f46e5; color:#ffffff; padding:12px 24px; text-decoration:none; border-radius:6px; font-size:16px; display:inline-block;">
                Verify Email
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding-top:20px; font-size:12px; color:#999; text-align:center;">
              <p>If you didn't create an account, you can safely ignore this email.</p>
              <p>© 2026 ElevateTrust AI</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

  const transporter = createTransporter();
  await transporter.sendMail({
    from: EMAIL_FROM,
    to: profile.email,
    subject: 'Verify Your Email - ElevateTrust AI',
    text: `Hello ${displayName}, verify your account using this link: ${verifyUrl}`,
    html: verifyEmailHtml,
  });
}

// ── registerUser ──────────────────────────────────────────────
async function registerUser(req, res) {
  try {
    const { userName, email, password, role = 'user' } = req.body || {};

    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!password) return res.status(400).json({ success: false, message: 'Password is required' });

    const normalizedEmail = String(email).trim().toLowerCase();

    // Check for existing user in profiles (email unique constraint)
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Create Supabase Auth user (stores password in auth.users)
    const { data: authData, error: signUpError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true, // skip Supabase's own email flow; we handle it below
    });

    if (signUpError) {
      if (signUpError.message?.includes('already registered')) {
        return res.status(400).json({ success: false, message: 'User already exists' });
      }
      console.error('supabase signUp error', signUpError);
      return res.status(500).json({ success: false, message: 'Server error' });
    }

    const authUserId = authData.user.id;

    // Insert profile row (our custom fields, NOT Supabase's built-in email_confirm)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authUserId,
        user_name: userName,
        email: normalizedEmail,
        role: ['user', 'admin'].includes(role) ? role : 'user',
        is_email_verified: false,
        analysis_requests_used: 0,
        analysis_request_limit: 5,
      })
      .select()
      .single();

    if (profileError) {
      // Rollback: delete auth user to avoid orphan
      await supabase.auth.admin.deleteUser(authUserId);
      console.error('profile insert error', profileError);
      return res.status(500).json({ success: false, message: 'Server error' });
    }

    // Send custom verification email (same template as old server)
    try {
      await sendEmailVerificationMail(profile);
    } catch (mailErr) {
      console.error('register verification mail error', mailErr?.message || mailErr);
      // Rollback both auth user and profile
      await supabase.auth.admin.deleteUser(authUserId);
      return res.status(502).json({
        success: false,
        message: 'Email service is not configured correctly. Please try again after mail setup.',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email before login.',
      user: {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        userName: profile.user_name,
        isEmailVerified: false,
        ...buildUsagePayload(profile),
      },
    });
  } catch (err) {
    console.error('registerUser error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── loginUser ─────────────────────────────────────────────────
async function loginUser(req, res) {
  const { email, password } = req.body;
  try {
    const normalizedEmail = String(email || '').trim().toLowerCase();

    // Fetch profile first (to check verification + block BEFORE Supabase Auth call)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (profileError || !profile) {
      return res.status(401).json({ success: false, message: "User doesn't exist" });
    }

    if (!profile.is_email_verified) {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email before logging in.',
      });
    }

    // BLOCK CHECK (identical logic to old server)
    if (profile.is_blocked) {
      const now = Date.now();
      if (profile.blocked_until) {
        if (new Date(profile.blocked_until).getTime() > now) {
          return res.status(403).json({
            success: false,
            message: `Account is blocked until ${new Date(profile.blocked_until).toLocaleString()}`,
            blockedUntil: profile.blocked_until,
          });
        }
        // Timed block expired → clear and continue
        await supabase
          .from('profiles')
          .update({ is_blocked: false, blocked_until: null })
          .eq('id', profile.id);
      } else {
        return res.status(403).json({
          success: false,
          message: 'Account is blocked (indefinite)',
          blockedUntil: null,
        });
      }
    }

    // Sign in via Supabase Auth (password check)
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (signInError) {
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }

    const accessToken = signInData.session.access_token;

    res.cookie(COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
      maxAge: 2 * 60 * 60 * 1000, // 2h (matches old server)
    });

    return res.json({
      success: true,
      message: 'Logged in successfully',
      user: {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        userName: profile.user_name,
        isEmailVerified: !!profile.is_email_verified,
        ...buildUsagePayload(profile),
      },
    });
  } catch (err) {
    console.error('loginUser error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── logoutUser ────────────────────────────────────────────────
async function logoutUser(req, res) {
  // Invalidate Supabase session if token exists
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    try {
      // Use a per-request client to sign out using the user's own token
      const { createClient } = require('@supabase/supabase-js');
      const userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await userClient.auth.signOut();
    } catch (e) {
      // Non-fatal: clear cookie regardless
    }
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ success: true, message: 'Logged out' });
}

// ── checkAuth ─────────────────────────────────────────────────
async function checkAuth(req, res) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorised' });

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) return res.status(401).json({ success: false, message: 'Unauthorised' });

    return res.json({
      success: true,
      user: {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        userName: profile.user_name,
        isEmailVerified: !!profile.is_email_verified,
        isBlocked: !!profile.is_blocked,
        blockedUntil: profile.blocked_until || null,
        ...buildUsagePayload(profile),
      },
    });
  } catch (err) {
    console.error('checkAuth error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── forgotPassword ────────────────────────────────────────────
async function forgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const { data: user } = await supabase
      .from('profiles')
      .select('id, email, reset_otp_expiry, reset_otp_attempts')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!user) {
      return res.json({ success: true, message: 'If an account exists for this email, an OTP has been sent.' });
    }

    const now = Date.now();
    if (
      user.reset_otp_expiry &&
      new Date(user.reset_otp_expiry).getTime() > now &&
      (user.reset_otp_attempts || 0) >= 5
    ) {
      return res.status(429).json({ success: false, message: 'Too many requests. Try again later.' });
    }

    const otp = generateOTP();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase
      .from('profiles')
      .update({ reset_otp_hash: otpHash, reset_otp_expiry: expiry, reset_otp_attempts: 0 })
      .eq('id', user.id);

    const transporter = createTransporter();
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: user.email,
      subject: 'Your password reset code',
      text: `Your password reset code is ${otp}. It expires in 10 minutes.`,
      html: `<p>Your password reset code is <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
    });

    return res.json({ success: true, message: 'If an account exists for this email, an OTP has been sent.' });
  } catch (err) {
    console.error('forgotPassword error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── verifyOtp ─────────────────────────────────────────────────
async function verifyOtp(req, res) {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP required' });

    const { data: user } = await supabase
      .from('profiles')
      .select('id, reset_otp_hash, reset_otp_expiry, reset_otp_attempts')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!user || !user.reset_otp_hash || !user.reset_otp_expiry) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // Expiry check
    if (new Date() > new Date(user.reset_otp_expiry)) {
      await supabase
        .from('profiles')
        .update({ reset_otp_hash: null, reset_otp_expiry: null, reset_otp_attempts: 0 })
        .eq('id', user.id);
      return res.status(400).json({ success: false, message: 'OTP expired' });
    }

    // Attempts throttle
    if ((user.reset_otp_attempts || 0) >= 5) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Request a new OTP.' });
    }

    // Compare
    const match = await bcrypt.compare(otp.toString(), user.reset_otp_hash);
    if (!match) {
      await supabase
        .from('profiles')
        .update({ reset_otp_attempts: (user.reset_otp_attempts || 0) + 1 })
        .eq('id', user.id);
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    // OTP valid → issue short-lived reset token
    const resetToken = crypto.randomBytes(24).toString('hex');
    const resetTokenHash = await bcrypt.hash(resetToken, 10);
    const resetExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await supabase
      .from('profiles')
      .update({
        reset_otp_hash: null,
        reset_otp_expiry: null,
        reset_otp_attempts: 0,
        password_reset_token_hash: resetTokenHash,
        password_reset_token_expiry: resetExpiry,
      })
      .eq('id', user.id);

    return res.json({ success: true, message: 'OTP verified', resetToken });
  } catch (err) {
    console.error('verifyOtp error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── resetPassword ─────────────────────────────────────────────
async function resetPassword(req, res) {
  try {
    const { email, resetToken, newPassword } = req.body || {};
    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, token and new password required' });
    }

    const { data: user } = await supabase
      .from('profiles')
      .select('id, email, password_reset_token_hash, password_reset_token_expiry')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!user || !user.password_reset_token_hash || !user.password_reset_token_expiry) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    if (new Date() > new Date(user.password_reset_token_expiry)) {
      await supabase
        .from('profiles')
        .update({ password_reset_token_hash: null, password_reset_token_expiry: null })
        .eq('id', user.id);
      return res.status(400).json({ success: false, message: 'Reset token expired' });
    }

    const ok = await bcrypt.compare(resetToken, user.password_reset_token_hash);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid reset token' });
    }

    // Update password in Supabase Auth
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (updateError) {
      console.error('supabase password update error', updateError);
      return res.status(500).json({ success: false, message: 'Server error' });
    }

    // Clear reset token fields and mark as verified (since they just proved email ownership via OTP)
    await supabase
      .from('profiles')
      .update({
        password_reset_token_hash: null,
        password_reset_token_expiry: null,
        is_email_verified: true,
        email_verified_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    // Confirmation email
    try {
      const transporter = createTransporter();
      await transporter.sendMail({
        from: EMAIL_FROM,
        to: user.email,
        subject: 'Your password has been changed',
        text: 'Your account password was changed. If you did not do this, contact support.',
      });
    } catch (e) {
      console.error('password change mail error', e);
    }

    return res.json({ success: true, message: 'Password updated. You can now log in.' });
  } catch (err) {
    console.error('resetPassword error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── verifyEmail ───────────────────────────────────────────────
async function verifyEmail(req, res) {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ success: false, message: 'Verification token is required' });
    }

    const now = new Date();
    let profile = null;

    // Short token flow (primary)
    if (!String(token).includes('.')) {
      const tokenHash = hashToken(token);
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('email_verification_token_hash', tokenHash)
        .gt('email_verification_token_expiry', now.toISOString())
        .maybeSingle();
      profile = data;
    }

    // Legacy JWT link backward compatibility
    if (!profile && String(token).includes('.')) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const { data: { user: authUser } } = await supabase.auth.getUser(token);
        if (authUser) {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', authUser.id)
            .maybeSingle();
          profile = data;
        }
      } catch {
        return res.status(400).json({ success: false, message: 'Verification link is invalid or expired' });
      }
    }

    if (!profile) {
      return res.status(400).json({ success: false, message: 'Verification link is invalid or expired' });
    }

    if (profile.is_email_verified) {
      return res.json({ success: true, message: 'Email is already verified' });
    }

    await supabase
      .from('profiles')
      .update({
        is_email_verified: true,
        email_verified_at: now.toISOString(),
        email_verification_token_hash: null,
        email_verification_token_expiry: null,
      })
      .eq('id', profile.id);

    return res.json({ success: true, message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    console.error('verifyEmail error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── resendVerificationEmail ───────────────────────────────────
async function resendVerificationEmail(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (!profile || profile.is_email_verified) {
      return res.json({ success: true, message: 'If this email is unverified, a verification link has been sent.' });
    }

    await sendEmailVerificationMail(profile);
    return res.json({ success: true, message: 'If this email is unverified, a verification link has been sent.' });
  } catch (err) {
    console.error('resendVerificationEmail error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── exports ───────────────────────────────────────────────────
module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  checkAuth,
  verifyEmail,
  resendVerificationEmail,
  forgotPassword,
  verifyOtp,
  resetPassword,
};
