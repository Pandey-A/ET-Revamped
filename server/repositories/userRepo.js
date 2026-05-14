const { query } = require('../db/pool');

/**
 * @param {import('pg').QueryResultRow} row
 * @param {{ includePassword?: boolean }} opts
 */
function mapRowToUser(row, opts = {}) {
  if (!row) return null;
  const u = {
    _id: row.id,
    id: row.id,
    userName: row.user_name,
    email: row.email,
    role: row.role,
    isEmailVerified: row.is_email_verified,
    emailVerifiedAt: row.email_verified_at,
    emailVerificationTokenHash: row.email_verification_token_hash,
    emailVerificationTokenExpiry: row.email_verification_token_expiry,
    analysisRequestsUsed: row.analysis_requests_used,
    analysisRequestLimit: row.analysis_request_limit,
    isBlocked: row.is_blocked,
    blockedUntil: row.blocked_until,
    resetOTPHash: row.reset_otp_hash,
    resetOTPExpiry: row.reset_otp_expiry,
    resetOTPAttempts: row.reset_otp_attempts,
    passwordResetTokenHash: row.password_reset_token_hash,
    passwordResetTokenExpiry: row.password_reset_token_expiry,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (opts.includePassword) u.password = row.password_hash;
  return u;
}

async function findByEmail(email) {
  const { rows } = await query(
    `SELECT * FROM users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`,
    [email]
  );
  return mapRowToUser(rows[0], { includePassword: true });
}

async function findById(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [String(id)]);
  return mapRowToUser(rows[0], { includePassword: true });
}

async function findByIdPublic(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [String(id)]);
  return mapRowToUser(rows[0], { includePassword: false });
}

async function findByVerificationTokenHash(hash) {
  const { rows } = await query(
    `SELECT * FROM users
     WHERE email_verification_token_hash = $1
       AND email_verification_token_expiry > now()
     LIMIT 1`,
    [hash]
  );
  return mapRowToUser(rows[0], { includePassword: true });
}

async function createUser(data) {
  const {
    id,
    userName,
    email,
    passwordHash,
    role = 'user',
    isEmailVerified = false,
    emailVerifiedAt = null,
    emailVerificationTokenHash = null,
    emailVerificationTokenExpiry = null,
    analysisRequestsUsed = 0,
    analysisRequestLimit = 5,
    isBlocked = false,
    blockedUntil = null,
    resetOTPHash = null,
    resetOTPExpiry = null,
    resetOTPAttempts = 0,
    passwordResetTokenHash = null,
    passwordResetTokenExpiry = null,
  } = data;

  await query(
    `INSERT INTO users (
      id, user_name, email, password_hash, role, is_email_verified, email_verified_at,
      email_verification_token_hash, email_verification_token_expiry,
      analysis_requests_used, analysis_request_limit, is_blocked, blocked_until,
      reset_otp_hash, reset_otp_expiry, reset_otp_attempts,
      password_reset_token_hash, password_reset_token_expiry
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
    )`,
    [
      id,
      userName,
      email,
      passwordHash,
      role,
      isEmailVerified,
      emailVerifiedAt,
      emailVerificationTokenHash,
      emailVerificationTokenExpiry,
      analysisRequestsUsed,
      analysisRequestLimit,
      isBlocked,
      blockedUntil,
      resetOTPHash,
      resetOTPExpiry,
      resetOTPAttempts,
      passwordResetTokenHash,
      passwordResetTokenExpiry,
    ]
  );
  return findById(id);
}

async function deleteById(id) {
  await query(`DELETE FROM users WHERE id = $1`, [String(id)]);
}

async function updateById(id, patch) {
  const allowed = {
    user_name: patch.user_name,
    email: patch.email,
    password_hash: patch.password_hash,
    role: patch.role,
    is_email_verified: patch.is_email_verified,
    email_verified_at: patch.email_verified_at,
    email_verification_token_hash: patch.email_verification_token_hash,
    email_verification_token_expiry: patch.email_verification_token_expiry,
    analysis_requests_used: patch.analysis_requests_used,
    analysis_request_limit: patch.analysis_request_limit,
    is_blocked: patch.is_blocked,
    blocked_until: patch.blocked_until,
    reset_otp_hash: patch.reset_otp_hash,
    reset_otp_expiry: patch.reset_otp_expiry,
    reset_otp_attempts: patch.reset_otp_attempts,
    password_reset_token_hash: patch.password_reset_token_hash,
    password_reset_token_expiry: patch.password_reset_token_expiry,
  };

  const keys = Object.keys(allowed).filter((k) => allowed[k] !== undefined);
  if (keys.length === 0) return findById(id);

  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => allowed[k]);
  await query(`UPDATE users SET ${sets}, updated_at = now() WHERE id = $1`, [String(id), ...values]);
  return findById(id);
}

/** Map mongoose-style camelCase patch to snake DB columns */
function camelPatchToSnake(p) {
  const m = {};
  if (p.userName !== undefined) m.user_name = p.userName;
  if (p.email !== undefined) m.email = p.email;
  if (p.password !== undefined) m.password_hash = p.password;
  if (p.role !== undefined) m.role = p.role;
  if (p.isEmailVerified !== undefined) m.is_email_verified = p.isEmailVerified;
  if (p.emailVerifiedAt !== undefined) m.email_verified_at = p.emailVerifiedAt;
  if (p.emailVerificationTokenHash !== undefined) m.email_verification_token_hash = p.emailVerificationTokenHash;
  if (p.emailVerificationTokenExpiry !== undefined) m.email_verification_token_expiry = p.emailVerificationTokenExpiry;
  if (p.analysisRequestsUsed !== undefined) m.analysis_requests_used = p.analysisRequestsUsed;
  if (p.analysisRequestLimit !== undefined) m.analysis_request_limit = p.analysisRequestLimit;
  if (p.isBlocked !== undefined) m.is_blocked = p.isBlocked;
  if (p.blockedUntil !== undefined) m.blocked_until = p.blockedUntil;
  if (p.resetOTPHash !== undefined) m.reset_otp_hash = p.resetOTPHash;
  if (p.resetOTPExpiry !== undefined) m.reset_otp_expiry = p.resetOTPExpiry;
  if (p.resetOTPAttempts !== undefined) m.reset_otp_attempts = p.resetOTPAttempts;
  if (p.passwordResetTokenHash !== undefined) m.password_reset_token_hash = p.passwordResetTokenHash;
  if (p.passwordResetTokenExpiry !== undefined) m.password_reset_token_expiry = p.passwordResetTokenExpiry;
  return m;
}

async function updateUserDoc(id, mongooseStylePatch) {
  const snake = camelPatchToSnake(mongooseStylePatch);
  return updateById(id, snake);
}

async function listAllLean() {
  const { rows } = await query(
    `SELECT id, user_name, email, role, is_email_verified, email_verified_at,
            analysis_requests_used, analysis_request_limit, is_blocked, blocked_until,
            created_at, updated_at
     FROM users ORDER BY created_at DESC`
  );
  return rows.map((r) => mapRowToUser(r, { includePassword: false }));
}

async function countByRole(role) {
  const { rows } = await query(`SELECT COUNT(*)::int AS c FROM users WHERE role = $1`, [role]);
  return rows[0]?.c ?? 0;
}

/**
 * Atomically increment analysis_requests_used if under limit.
 * @returns {Promise<{ ok: boolean, user?: ReturnType<typeof mapRowToUser> }>}
 */
async function incrementAnalysisIfUnderLimit(userId) {
  const { rows } = await query(
    `UPDATE users
     SET analysis_requests_used = analysis_requests_used + 1, updated_at = now()
     WHERE id = $1 AND analysis_requests_used < analysis_request_limit
     RETURNING *`,
    [String(userId)]
  );
  if (!rows[0]) return { ok: false };
  return { ok: true, user: mapRowToUser(rows[0], { includePassword: false }) };
}

async function decrementAnalysisUsed(userId) {
  await query(
    `UPDATE users
     SET analysis_requests_used = GREATEST(analysis_requests_used - 1, 0), updated_at = now()
     WHERE id = $1`,
    [String(userId)]
  );
}

async function selectQuotaFields(userId) {
  const { rows } = await query(
    `SELECT analysis_requests_used, analysis_request_limit FROM users WHERE id = $1`,
    [String(userId)]
  );
  return rows[0] || null;
}

module.exports = {
  mapRowToUser,
  findByEmail,
  findById,
  findByIdPublic,
  findByVerificationTokenHash,
  createUser,
  deleteById,
  updateById,
  updateUserDoc,
  listAllLean,
  countByRole,
  incrementAnalysisIfUnderLimit,
  decrementAnalysisUsed,
  selectQuotaFields,
};
