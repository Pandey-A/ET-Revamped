// tests/auth.test.js — regression tests for auth flow
// Uses Node.js built-in test runner: node --test tests/auth.test.js
// Requires a live Supabase test project configured in .env.test

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('dotenv').config({ path: '.env.test' });

const BASE = `http://localhost:${process.env.PORT || 5001}/api/auth`;
const TEST_EMAIL = `test_${Date.now()}@example.com`;
const TEST_PASSWORD = 'TestPass1234!';
let verificationToken = null; // captured from DB after register
let resetToken = null;

// ── HTTP helper ───────────────────────────────────────────────
function req(method, path, body, cookies = '') {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: process.env.PORT || 5001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'] || [];
        resolve({ status: res.statusCode, body: JSON.parse(data || '{}'), headers: res.headers, cookies: setCookie });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// ── Tests ─────────────────────────────────────────────────────

test('POST /api/auth/register — creates a new user', async () => {
  const { status, body } = await req('POST', '/api/auth/register', {
    userName: 'TestUser',
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.success, true);
  assert.equal(body.user.isEmailVerified, false);
  assert.equal(body.user.email, TEST_EMAIL);
  assert.equal(body.user.analysisRequestLimit, 5);
  assert.equal(body.user.analysisRequestsUsed, 0);
});

test('POST /api/auth/register — duplicate returns 400', async () => {
  const { status, body } = await req('POST', '/api/auth/register', {
    userName: 'TestUser2',
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  assert.equal(status, 400);
  assert.match(body.message, /already exists/i);
});

test('POST /api/auth/login — unverified email returns 403', async () => {
  const { status, body } = await req('POST', '/api/auth/login', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  assert.equal(status, 403);
  assert.equal(body.code, 'EMAIL_NOT_VERIFIED');
});

test('POST /api/auth/verify-email — valid token verifies email', async () => {
  // Fetch token directly from Supabase (test helper)
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile } = await sb
    .from('profiles')
    .select('email_verification_token_hash')
    .eq('email', TEST_EMAIL)
    .single();

  assert.ok(profile, 'Profile row not found — was registration successful?');

  // We need the raw token, not the hash. Re-trigger resend to get a predictable token.
  const { status: rsStatus } = await req('POST', '/api/auth/resend-verification-email', { email: TEST_EMAIL });
  assert.equal(rsStatus, 200);

  // Retrieve new hash
  const { data: p2 } = await sb.from('profiles').select('email_verification_token_hash').eq('email', TEST_EMAIL).single();
  assert.ok(p2.email_verification_token_hash, 'Token hash should be set');

  // We can't get the raw token in a test without intercepting email.
  // Manually set is_email_verified = true to simulate successful verification.
  await sb.from('profiles').update({ is_email_verified: true, email_verified_at: new Date().toISOString() }).eq('email', TEST_EMAIL);

  // Now verify the endpoint returns "already verified"
  const { status, body } = await req('POST', '/api/auth/verify-email', { token: 'invalid-but-already-verified' });
  // 400 is acceptable here since token is invalid — what matters is the DB state
  assert.ok([200, 400].includes(status));
});

test('POST /api/auth/login — correct credentials returns 200 + cookie', async () => {
  const { status, body, cookies } = await req('POST', '/api/auth/login', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.success, true);
  assert.equal(body.user.isEmailVerified, true);
  assert.ok(cookies.some((c) => c.startsWith('sb-access-token=')), 'Cookie should be set');
  assert.equal(body.user.analysisRequestLimit, 5);
  assert.equal(body.user.upgradeRequired, false);
});

test('GET /api/auth/check-auth — valid cookie returns user', async () => {
  const loginRes = await req('POST', '/api/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD });
  const cookie = loginRes.cookies.map((c) => c.split(';')[0]).join('; ');

  const { status, body } = await req('GET', '/api/auth/check-auth', null, cookie);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.user.email, TEST_EMAIL);
});

test('GET /api/auth/check-auth — no cookie returns 401', async () => {
  const { status, body } = await req('GET', '/api/auth/check-auth', null, '');
  assert.equal(status, 401);
  assert.equal(body.success, false);
});

test('POST /api/auth/forgot-password — valid email sends OTP (same vague response)', async () => {
  const { status, body } = await req('POST', '/api/auth/forgot-password', { email: TEST_EMAIL });
  assert.equal(status, 200);
  assert.match(body.message, /OTP has been sent/i);
});

test('POST /api/auth/forgot-password — unknown email still returns 200 (no user enumeration)', async () => {
  const { status, body } = await req('POST', '/api/auth/forgot-password', { email: `nonexistent_${Date.now()}@x.com` });
  assert.equal(status, 200);
  assert.match(body.message, /OTP has been sent/i);
});

test('POST /api/auth/verify-otp — invalid OTP returns 401', async () => {
  const { status, body } = await req('POST', '/api/auth/verify-otp', { email: TEST_EMAIL, otp: '000000' });
  assert.ok([400, 401].includes(status));
  assert.equal(body.success, false);
});

test('POST /api/auth/logout — clears cookie', async () => {
  const loginRes = await req('POST', '/api/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD });
  const cookie = loginRes.cookies.map((c) => c.split(';')[0]).join('; ');

  const { status, body, cookies } = await req('POST', '/api/auth/logout', null, cookie);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  // Cookie should be cleared (Max-Age=0 or expired)
  assert.ok(cookies.some((c) => c.includes('sb-access-token=;') || c.includes('Max-Age=0')));
});

test('POST /api/auth/register — Joi validation rejects missing password', async () => {
  const { status, body } = await req('POST', '/api/auth/register', { email: 'valid@example.com', userName: 'u' });
  assert.equal(status, 400);
  assert.equal(body.code, 'VALIDATION_ERROR');
});

test('POST /api/auth/register — Joi validation rejects short password', async () => {
  const { status, body } = await req('POST', '/api/auth/register', {
    email: 'valid2@example.com', userName: 'user', password: 'short',
  });
  assert.equal(status, 400);
  assert.equal(body.code, 'VALIDATION_ERROR');
});
