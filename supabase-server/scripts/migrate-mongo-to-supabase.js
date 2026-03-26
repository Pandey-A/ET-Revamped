#!/usr/bin/env node
// scripts/migrate-mongo-to-supabase.js
// Migrates all User documents and UsageLog documents from MongoDB → Supabase.
//
// Usage:
//   MONGO_URI=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-mongo-to-supabase.js
//   or: copy .env.migration, fill it in, then: node -r dotenv/config scripts/migrate-mongo-to-supabase.js
//
// What it does per user:
//   1. Creates a Supabase Auth user (random strong password, email pre-confirmed)
//   2. Inserts a profiles row preserving all custom fields
//   3. Sends a password-reset email so existing users can set a new password
//
// What it does per usage log:
//   1. Inserts a usage_logs row mapped from Mongoose → Postgres schema
//
// Run with --dry-run to see counts without writing anything.
// Run with --skip-emails to skip sending password reset emails.

require('dotenv').config();
const mongoose = require('mongoose');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_EMAILS = process.argv.includes('--skip-emails');

const MONGO_URI = process.env.MONGO_URI;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const EMAIL_FROM = process.env.EMAIL_FROM || '';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.resend.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || 'resend';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || SMTP_PORT === 465;

if (!MONGO_URI || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Required env vars: MONGO_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── MongoDB Schemas (inline — no import needed) ───────────────
const userSchema = new mongoose.Schema({
  userName: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, default: 'user' },
  isEmailVerified: { type: Boolean, default: false },
  emailVerifiedAt: Date,
  emailVerificationTokenHash: String,
  emailVerificationTokenExpiry: Date,
  analysisRequestsUsed: { type: Number, default: 0 },
  analysisRequestLimit: { type: Number, default: 5 },
  isBlocked: { type: Boolean, default: false },
  blockedUntil: Date,
  resetOTPHash: String,
  resetOTPExpiry: Date,
  resetOTPAttempts: { type: Number, default: 0 },
  passwordResetTokenHash: String,
  passwordResetTokenExpiry: Date,
}, { timestamps: true });

const usageLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  serviceType: String,
  fileName: String,
  pastedUrl: String,
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const UsageLog = mongoose.models.UsageLog || mongoose.model('UsageLog', usageLogSchema);

// ── Email helper ──────────────────────────────────────────────
let transporter = null;
function getTransporter() {
  if (!transporter && SMTP_PASS && EMAIL_FROM) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

async function sendPasswordResetNotice(email, userName) {
  if (SKIP_EMAILS || !getTransporter()) return;
  try {
    await getTransporter().sendMail({
      from: EMAIL_FROM,
      to: email,
      subject: 'Action Required: Reset Your ElevateTrust AI Password',
      text: `Hello ${userName || 'there'},\n\nWe have upgraded our platform. As part of this upgrade, you need to reset your password before logging in again.\n\nPlease visit ${FRONTEND_URL}/forgot-password to reset your password.\n\nYour email and all account data have been preserved.\n\n© 2026 ElevateTrust AI`,
      html: `
        <p>Hello <strong>${userName || 'there'}</strong>,</p>
        <p>We have upgraded our platform. As part of this upgrade, you need to <strong>reset your password</strong> before logging in again.</p>
        <p><a href="${FRONTEND_URL}/forgot-password" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Reset My Password</a></p>
        <p>Your email and all account data have been preserved.</p>
        <p>© 2026 ElevateTrust AI</p>
      `,
    });
  } catch (e) {
    console.warn(`  ⚠ Email failed for ${email}: ${e.message}`);
  }
}

// ── Main migration ────────────────────────────────────────────
async function run() {
  console.log(`\n🚀 MongoDB → Supabase migration ${DRY_RUN ? '[DRY RUN]' : '[LIVE]'}\n`);

  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected');

  const users = await User.find().lean();
  const usageLogs = await UsageLog.find().lean();
  console.log(`📊 Found ${users.length} users and ${usageLogs.length} usage logs\n`);

  // Build a map: mongo ObjectId → supabase UUID (for usage_logs FK)
  const idMap = new Map(); // mongoId string → supabase uuid

  let successUsers = 0, failedUsers = 0;
  let successLogs = 0, failedLogs = 0;

  // ── Migrate users ─────────────────────────────────────────
  console.log('──── Migrating Users ────');
  for (const u of users) {
    const mongoId = String(u._id);
    const email = String(u.email || '').toLowerCase();

    if (DRY_RUN) {
      console.log(`  [dry] would migrate user: ${email}`);
      idMap.set(mongoId, crypto.randomUUID()); // fake uuid for dry run
      successUsers++;
      continue;
    }

    try {
      // 1. Create Supabase Auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomBytes(32).toString('hex'), // random unguessable temp password
      });

      if (authError) {
        // Handle duplicate (user already migrated)
        if (authError.message?.toLowerCase().includes('already registered') || authError.status === 422) {
          // Fetch existing auth user by email
          const { data: { users: existing } } = await supabase.auth.admin.listUsers();
          const alreadyMigrated = existing?.find((eu) => eu.email === email);
          if (alreadyMigrated) {
            idMap.set(mongoId, alreadyMigrated.id);
            console.log(`  ⚡ Already exists (skipped): ${email}`);
            successUsers++;
            continue;
          }
        }
        throw authError;
      }

      const supabaseId = authData.user.id;
      idMap.set(mongoId, supabaseId);

      // 2. Insert profiles row
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: supabaseId,
        user_name: u.userName || email.split('@')[0],
        email,
        role: ['user', 'admin'].includes(u.role) ? u.role : 'user',
        is_email_verified: !!u.isEmailVerified,
        email_verified_at: u.emailVerifiedAt ? new Date(u.emailVerifiedAt).toISOString() : null,
        analysis_requests_used: Number(u.analysisRequestsUsed || 0),
        analysis_request_limit: Number(u.analysisRequestLimit || 5),
        is_blocked: !!u.isBlocked,
        blocked_until: u.blockedUntil ? new Date(u.blockedUntil).toISOString() : null,
        // OTP/reset fields are intentionally cleared — they were bcrypt-hashed against old secrets
        reset_otp_hash: null,
        reset_otp_expiry: null,
        reset_otp_attempts: 0,
        password_reset_token_hash: null,
        password_reset_token_expiry: null,
        created_at: u.createdAt ? new Date(u.createdAt).toISOString() : new Date().toISOString(),
        updated_at: u.updatedAt ? new Date(u.updatedAt).toISOString() : new Date().toISOString(),
      }, { onConflict: 'id' });

      if (profileError) throw profileError;

      // 3. Send password-reset notice
      await sendPasswordResetNotice(email, u.userName);

      console.log(`  ✅ Migrated: ${email} (${supabaseId})`);
      successUsers++;
    } catch (err) {
      console.error(`  ❌ Failed: ${email} — ${err.message || err}`);
      failedUsers++;
    }
  }

  // ── Migrate usage logs ────────────────────────────────────
  console.log('\n──── Migrating Usage Logs ────');
  const SERVICE_TYPE_MAP = {
    video_upload: 'video_upload',
    image_upload: 'image_upload',
    url_paste: 'url_paste',
  };

  for (const log of usageLogs) {
    const mongoUserId = String(log.user);
    const supabaseUserId = idMap.get(mongoUserId);

    if (!supabaseUserId) {
      console.warn(`  ⚠ Skipping log — no supabase user for mongo id ${mongoUserId}`);
      failedLogs++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [dry] would insert log: ${log.serviceType} for ${supabaseUserId}`);
      successLogs++;
      continue;
    }

    const serviceType = SERVICE_TYPE_MAP[log.serviceType];
    if (!serviceType) {
      console.warn(`  ⚠ Unknown serviceType: ${log.serviceType} — skipping`);
      failedLogs++;
      continue;
    }

    try {
      const { error } = await supabase.from('usage_logs').insert({
        user_id: supabaseUserId,
        service_type: serviceType,
        file_name: log.fileName || null,
        pasted_url: log.pastedUrl || null,
        created_at: log.createdAt ? new Date(log.createdAt).toISOString() : new Date().toISOString(),
      });

      if (error) throw error;
      successLogs++;
    } catch (err) {
      console.error(`  ❌ Log insert failed: ${err.message || err}`);
      failedLogs++;
    }
  }

  // ── Summary ───────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log(`MIGRATION SUMMARY ${DRY_RUN ? '[DRY RUN — no data written]' : '[COMPLETE]'}`);
  console.log('──────────────────────────────────────────');
  console.log(`Users:      ${successUsers} ok, ${failedUsers} failed  (total: ${users.length})`);
  console.log(`Usage logs: ${successLogs} ok, ${failedLogs} failed  (total: ${usageLogs.length})`);
  console.log('══════════════════════════════════════════\n');

  await mongoose.disconnect();
  process.exit(failedUsers + failedLogs > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Migration crashed:', err);
  process.exit(1);
});
