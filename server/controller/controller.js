// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const auth = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'CLIENT_SECRET_KEY';
const COOKIE_NAME = 'token';

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

// helper: create transporter (dev). Replace with SMTP / SendGrid in prod
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER || process.env.ETHEREAL_USER,
      pass: process.env.SMTP_PASS || process.env.ETHEREAL_PASS,
    },
  });
}

// -------------------- register --------------------
// controllers/authController.js -> registerUser (replace existing)
async function registerUser(req, res) {
  try {
    console.log('registerUser body:', req.body); // <--- debug: what arrives
    const { userName, email, password, role = 'user' } = req.body || {};

    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!password) return res.status(400).json({ success: false, message: 'Password is required' });

    const normalizedEmail = String(email).trim().toLowerCase();

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(400).json({ success: false, message: 'User already exists' });

    const hashed = await bcrypt.hash(password, 12);
    const u = new User({ userName, email: normalizedEmail, password: hashed, role });
    await u.save();

    return res.status(201).json({
      success: true,
      user: {
        id: u._id,
        email: u.email,
        role: u.role,
        userName: u.userName,
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
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, message: "User doesn't exist" });

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
      secure: false,
      sameSite: 'lax',
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
      from: process.env.EMAIL_FROM || 'no-reply@yourapp.com',
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
    await user.save();

    // Debug logs (safe: show lengths and expiry only)
    console.log('VERIFY-OTP: generated resetToken length:', resetToken.length);
    console.log('VERIFY-OTP: saved passwordResetTokenExpiry:', user.passwordResetTokenExpiry && user.passwordResetTokenExpiry.toISOString());
    console.log('VERIFY-OTP: passwordResetTokenHash exists:', !!user.passwordResetTokenHash);

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
    console.log('--- resetPassword called ---');
    console.log('resetPassword req.body:', req.body); // shows incoming email, resetToken, newPassword

    const { email, resetToken, newPassword } = req.body || {};
    if (!email || !resetToken || !newPassword) {
      console.log('resetPassword: missing field(s)', { email: !!email, resetToken: !!resetToken, newPassword: !!newPassword });
      return res.status(400).json({ success: false, message: 'Email, token and new password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    console.log('resetPassword: user found?', !!user, 'email:', user?.email);
    console.log('resetPassword: stored passwordResetTokenExpiry:', user?.passwordResetTokenExpiry && user.passwordResetTokenExpiry.toISOString());
    console.log('resetPassword: passwordResetTokenHash exists?', !!user?.passwordResetTokenHash);

    if (!user || !user.passwordResetTokenHash || !user.passwordResetTokenExpiry) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    if (new Date() > user.passwordResetTokenExpiry) {
      console.log('resetPassword: token expired now:', new Date().toISOString());
      user.passwordResetTokenHash = null;
      user.passwordResetTokenExpiry = null;
      await user.save();
      return res.status(400).json({ success: false, message: 'Reset token expired' });
    }

    console.log('resetPassword: about to compare incoming token length:', resetToken.length);
    const ok = await bcrypt.compare(resetToken, user.passwordResetTokenHash);
    console.log('resetPassword: bcrypt.compare result:', ok);
    if (!ok) {
      console.log('resetPassword: token compare failed. incoming token (first40):', resetToken.slice(0,40));
      return res.status(401).json({ success: false, message: 'Invalid reset token' });
    }
    // ... continue as before


    const hashed = await bcrypt.hash(newPassword, 12);
    user.password = hashed;
    user.passwordResetTokenHash = null;
    user.passwordResetTokenExpiry = null;
    await user.save();

    try {
      const transporter = createTransporter();
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || 'no-reply@yourapp.com',
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

// -------------------- exports --------------------
module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  checkAuth,
  forgotPassword,
  verifyOtp,
  resetPassword
};
