/**
 * One-time copy of legacy MongoDB `users` and `usagelogs` into PostgreSQL.
 *
 * Prerequisites:
 *   - `npm run db:migrate` (schema applied)
 *   - `.env` with `DATABASE_URL` and `MONGO_URI`
 *
 * Usage (from `server/`): `npm run db:migrate-from-mongo`
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const { query, getPool } = require('../db/pool');

async function migrateUsers() {
  const db = mongoose.connection.db;
  const col = db.collection('users');
  const docs = await col.find({}).toArray();
  let n = 0;
  for (const u of docs) {
    const id = String(u._id);
    await query(
      `INSERT INTO users (
        id, user_name, email, password_hash, role, is_email_verified, email_verified_at,
        email_verification_token_hash, email_verification_token_expiry,
        analysis_requests_used, analysis_request_limit, is_blocked, blocked_until,
        reset_otp_hash, reset_otp_expiry, reset_otp_attempts,
        password_reset_token_hash, password_reset_token_expiry,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, COALESCE($19, now()), COALESCE($20, now())
      )
      ON CONFLICT (id) DO UPDATE SET
        user_name = EXCLUDED.user_name,
        email = EXCLUDED.email,
        password_hash = EXCLUDED.password_hash,
        role = EXCLUDED.role,
        is_email_verified = EXCLUDED.is_email_verified,
        email_verified_at = EXCLUDED.email_verified_at,
        email_verification_token_hash = EXCLUDED.email_verification_token_hash,
        email_verification_token_expiry = EXCLUDED.email_verification_token_expiry,
        analysis_requests_used = EXCLUDED.analysis_requests_used,
        analysis_request_limit = EXCLUDED.analysis_request_limit,
        is_blocked = EXCLUDED.is_blocked,
        blocked_until = EXCLUDED.blocked_until,
        reset_otp_hash = EXCLUDED.reset_otp_hash,
        reset_otp_expiry = EXCLUDED.reset_otp_expiry,
        reset_otp_attempts = EXCLUDED.reset_otp_attempts,
        password_reset_token_hash = EXCLUDED.password_reset_token_hash,
        password_reset_token_expiry = EXCLUDED.password_reset_token_expiry,
        updated_at = now()`,
      [
        id,
        u.userName || u.username || 'user',
        String(u.email || '').toLowerCase().trim(),
        u.password,
        u.role === 'admin' ? 'admin' : 'user',
        !!u.isEmailVerified,
        u.emailVerifiedAt || null,
        u.emailVerificationTokenHash || null,
        u.emailVerificationTokenExpiry || null,
        Math.max(0, Number(u.analysisRequestsUsed) || 0),
        Math.max(1, Number(u.analysisRequestLimit) || 5),
        !!u.isBlocked,
        u.blockedUntil || null,
        u.resetOTPHash || null,
        u.resetOTPExpiry || null,
        Number(u.resetOTPAttempts) || 0,
        u.passwordResetTokenHash || null,
        u.passwordResetTokenExpiry || null,
        u.createdAt || null,
        u.updatedAt || null,
      ]
    );
    n += 1;
  }
  return n;
}

async function migrateUsageLogs() {
  const db = mongoose.connection.db;
  const cols = (await db.listCollections().toArray()).map((c) => c.name);
  const collName =
    cols.find((n) => n === 'usagelogs') ||
    cols.find((n) => /usagelog/i.test(n)) ||
    cols.find((n) => /usage_log/i.test(n));
  if (!collName) {
    console.warn('No usage log collection found (expected usagelogs); skipping usage_logs.');
    return 0;
  }
  console.log('Reading usage logs from Mongo collection:', collName);
  const col = db.collection(collName);
  const docs = await col.find({}).toArray();
  let n = 0;
  for (const log of docs) {
    const userId = log.user ? String(log.user) : null;
    if (!userId) continue;
    const st = log.serviceType;
    if (!['video_upload', 'image_upload', 'url_paste'].includes(st)) continue;
    await query(
      `INSERT INTO usage_logs (user_id, service_type, file_name, pasted_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, now()), COALESCE($6, now()))`,
      [
        userId,
        st,
        log.fileName || null,
        log.pastedUrl || null,
        log.createdAt || null,
        log.updatedAt || null,
      ]
    );
    n += 1;
  }
  return n;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is required');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('MongoDB connected');

  try {
    const userCount = await migrateUsers();
    console.log(`Upserted ${userCount} users`);

    const logCount = await migrateUsageLogs();
    console.log(`Inserted ${logCount} usage log rows`);
  } finally {
    await mongoose.disconnect().catch(() => {});
    await getPool().end().catch(() => {});
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
