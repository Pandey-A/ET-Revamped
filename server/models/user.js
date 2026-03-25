// models/User.js (example)
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum:["user" , "admin"], default: 'user' },
  analysisRequestsUsed: { type: Number, default: 0, min: 0 },
  analysisRequestLimit: { type: Number, default: 5, min: 1 },
  isBlocked: { type: Boolean, default: false },
  blockedUntil: { type: Date, default: null },
  // --- forgot/reset fields ---
  resetOTPHash: { type: String, default: null },           // hashed OTP (one-time)
  resetOTPExpiry: { type: Date, default: null },           // OTP expiry timestamp
  resetOTPAttempts: { type: Number, default: 0 },          // throttle attempts

  passwordResetTokenHash: { type: String, default: null }, // hashed reset token after OTP verification
  passwordResetTokenExpiry: { type: Date, default: null }, // reset token expiry
},
{
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
