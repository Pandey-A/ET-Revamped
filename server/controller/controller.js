// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'CLIENT_SECRET_KEY';
const EMAIL_VERIFY_SECRET = process.env.EMAIL_VERIFY_SECRET || JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const COOKIE_NAME = 'token';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.resend.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || 'resend';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || SMTP_PORT === 465;
const EMAIL_FROM = process.env.EMAIL_FROM || '';

let cachedTransporter = null;

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

// helper: generate 6-digit OTP
function generateOTP() {


  return Math.floor(100000 + Math.random() * 900000).toString();
}

function assertMailConfig() {
  if (!SMTP_PASS) {
    throw new Error('SMTP_PASS is missing. Configure Resend SMTP password in server .env');
  }
  if (!EMAIL_FROM) {
    throw new Error('EMAIL_FROM is missing. Configure a verified sender in server .env');
  }
}

function createTransporter() {
  assertMailConfig();
  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return cachedTransporter;
}

function createShortVerificationToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function sendEmailVerificationMail(user) {
  const verificationToken = createShortVerificationToken();
  user.emailVerificationTokenHash = hashToken(verificationToken);
  user.emailVerificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await user.save();

  const verifyUrl = `${FRONTEND_URL}/v/${encodeURIComponent(verificationToken)}`;
  const displayName = user?.userName ? String(user.userName) : 'User';
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
              <p>If you didn\'t create an account, you can safely ignore this email.</p>
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
    to: user.email,
    subject: 'Verify Your Email - ElevateTrust AI',
    text: `Hello ${displayName}, verify your account using this link: ${verifyUrl}`,
    html: verifyEmailHtml,
  });
}

// -------------------- register --------------------
// controllers/authController.js -> registerUser (replace existing)
async function registerUser(req, res) {
  try {
    const { userName, email, password, role = 'user' } = req.body || {};

    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!password) return res.status(400).json({ success: false, message: 'Password is required' });

    const normalizedEmail = String(email).trim().toLowerCase();

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(400).json({ success: false, message: 'User already exists' });

    const hashed = await bcrypt.hash(password, 12);
    const u = new User({ userName, email: normalizedEmail, password: hashed, role });
    await u.save();

    try {
      await sendEmailVerificationMail(u);
    } catch (mailErr) {
      console.error('register verification mail error', mailErr?.message || mailErr);
      await User.deleteOne({ _id: u._id });
      return res.status(502).json({
        success: false,
        message: 'Email service is not configured correctly. Please try again after mail setup.',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email before login.',
      user: {
        id: u._id,
        email: u.email,
        role: u.role,
        userName: u.userName,
        isEmailVerified: !!u.isEmailVerified,
        ...buildUsagePayload(u),
      }
    });
  } catch (err) {
    console.error('registerUser error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}


// -------------------- login --------------------
async function loginUser(req, res) {
  const { email, password } = req.body;
  try {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(401).json({ success: false, message: "User doesn't exist" });

    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email before logging in.',
      });
    }

    // BLOCK CHECK
    if (user.isBlocked) {
      const now = Date.now();
      if (user.blockedUntil) {
        if (new Date(user.blockedUntil).getTime() > now) {
          return res.status(403).json({
            success: false,
            message: `Account is blocked until ${new Date(user.blockedUntil).toLocaleString()}`,
            blockedUntil: user.blockedUntil
          });
        }
        // timed block expired -> clear and continue
        user.isBlocked = false;
        user.blockedUntil = null;
        await user.save();
      } else {
        // indefinite block
        return res.status(403).json({
          success: false,
          message: 'Account is blocked (indefinite)',
          blockedUntil: null
        });
      }
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ success: false, message: 'Incorrect password' });

    const payload = { id: user._id, role: user.role, email: user.email, userName: user.userName };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
      maxAge: 2 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      message: 'Logged in successfully',
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        userName: user.userName,
        isEmailVerified: !!user.isEmailVerified,
        ...buildUsagePayload(user),
      }
    });
  } catch (err) {
    console.error('loginUser error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// -------------------- logout --------------------
function logoutUser(req, res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ success: true, message: 'Logged out' });
}

// -------------------- check-auth --------------------
async function checkAuth(req, res) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorised' });
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorised' });

    return res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        userName: user.userName,
        isEmailVerified: !!user.isEmailVerified,
        isBlocked: !!user.isBlocked,
        blockedUntil: user.blockedUntil || null,
        ...buildUsagePayload(user),
      }
    });
  } catch (err) {
    console.error('checkAuth error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// -------------------- forgotPassword --------------------
async function forgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Do not reveal existence
      return res.json({ success: true, message: 'If an account exists for this email, an OTP has been sent.' });
    }

    const now = Date.now();
    if (user.resetOTPExpiry && user.resetOTPExpiry.getTime() > now && (user.resetOTPAttempts || 0) >= 5) {
      return res.status(429).json({ success: false, message: 'Too many requests. Try again later.' });
    }

    const otp = generateOTP();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiry = new Date(Date.now() + (10 * 60 * 1000)); // 10 minutes

    user.resetOTPHash = otpHash;
    user.resetOTPExpiry = expiry;
    user.resetOTPAttempts = 0;
    await user.save();

    const transporter = createTransporter();
    const mailOptions = {
      from: EMAIL_FROM,
      to: user.email,
      subject: 'Your password reset code',
      text: `Your password reset code is ${otp}. It expires in 10 minutes.`,
      html: `<p>Your password reset code is <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
    };

    await transporter.sendMail(mailOptions);

    return res.json({ success: true, message: 'If an account exists for this email, an OTP has been sent.' });
  } catch (err) {
    console.error('forgotPassword error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// -------------------- verifyOtp --------------------
// -------------------- verifyOtp --------------------
async function verifyOtp(req, res) {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.resetOTPHash || !user.resetOTPExpiry) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // Expiry check
    if (new Date() > user.resetOTPExpiry) {
      user.resetOTPHash = null;
      user.resetOTPExpiry = null;
      user.resetOTPAttempts = 0;
      await user.save();
      return res.status(400).json({ success: false, message: 'OTP expired' });
    }

    // Attempts throttle
    if ((user.resetOTPAttempts || 0) >= 5) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Request a new OTP.' });
    }

    // Compare OTP
    const match = await bcrypt.compare(otp.toString(), user.resetOTPHash);
    if (!match) {
      user.resetOTPAttempts = (user.resetOTPAttempts || 0) + 1;
      await user.save();
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    // OTP valid -> create a one-time reset token (plaintext) and save its hash
    const resetToken = crypto.randomBytes(24).toString('hex');
    const resetTokenHash = await bcrypt.hash(resetToken, 10);

    // clear OTP fields and set reset token + expiry
    user.resetOTPHash = null;
    user.resetOTPExpiry = null;
    user.resetOTPAttempts = 0;
    user.passwordResetTokenHash = resetTokenHash;
    user.passwordResetTokenExpiry = new Date(Date.now() + (15 * 60 * 1000)); // 15 minutes
    // OTP verification proves email ownership, so mark as verified
    user.isEmailVerified = true;
    user.emailVerifiedAt = new Date();
    await user.save();

    // Return plaintext resetToken to client (short-lived)
    return res.json({ success: true, message: 'OTP verified', resetToken });
  } catch (err) {
    console.error('verifyOtp error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// -------------------- resetPassword --------------------
async function resetPassword(req, res) {
  try {
    const { email, resetToken, newPassword } = req.body || {};
    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, token and new password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user || !user.passwordResetTokenHash || !user.passwordResetTokenExpiry) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    if (new Date() > user.passwordResetTokenExpiry) {
      user.passwordResetTokenHash = null;
      user.passwordResetTokenExpiry = null;
      await user.save();
      return res.status(400).json({ success: false, message: 'Reset token expired' });
    }

    const ok = await bcrypt.compare(resetToken, user.passwordResetTokenHash);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid reset token' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    user.password = hashed;
    user.passwordResetTokenHash = null;
    user.passwordResetTokenExpiry = null;
    await user.save();

    try {
      const transporter = createTransporter();
      await transporter.sendMail({
        from: EMAIL_FROM,
        to: user.email,
        subject: 'Your password has been changed',
        text: `Your account password was changed. If you did not do this, contact support.`,
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

async function verifyEmail(req, res) {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ success: false, message: 'Verification token is required' });
    }

    const now = new Date();
    let user = null;

    // One-time short token flow
    if (!String(token).includes('.')) {
      const tokenHash = hashToken(token);
      user = await User.findOne({
        emailVerificationTokenHash: tokenHash,
        emailVerificationTokenExpiry: { $gt: now },
      });
    }

    // Backward compatibility for legacy JWT links
    if (!user && String(token).includes('.')) {
      let decoded;
      try {
        decoded = jwt.verify(token, EMAIL_VERIFY_SECRET);
      } catch (err) {
        return res.status(400).json({ success: false, message: 'Verification link is invalid or expired' });
      }

      if (decoded?.purpose !== 'email_verify' || !decoded?.id) {
        return res.status(400).json({ success: false, message: 'Invalid verification token' });
      }

      user = await User.findById(decoded.id);
    }

    if (!user) {
      return res.status(400).json({ success: false, message: 'Verification link is invalid or expired' });
    }

    if (user.isEmailVerified) {
      return res.json({ success: true, message: 'Email is already verified' });
    }

    user.isEmailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerificationTokenHash = null;
    user.emailVerificationTokenExpiry = null;
    await user.save();

    return res.json({ success: true, message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    console.error('verifyEmail error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

async function resendVerificationEmail(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user || user.isEmailVerified) {
      return res.json({ success: true, message: 'If this email is unverified, a verification link has been sent.' });
    }

    await sendEmailVerificationMail(user);
    return res.json({ success: true, message: 'If this email is unverified, a verification link has been sent.' });
  } catch (err) {
    console.error('resendVerificationEmail error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// -------------------- exports --------------------
module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  checkAuth,
  verifyEmail,
  resendVerificationEmail,
  forgotPassword,
  verifyOtp,
  resetPassword
};
