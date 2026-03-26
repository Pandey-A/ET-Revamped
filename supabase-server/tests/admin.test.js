// tests/admin.test.js — regression tests for admin routes
// Requires an admin user to be seeded in .env.test as TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
require('dotenv').config({ path: '.env.test' });

const PORT = process.env.PORT || 5001;
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD in .env.test');
  process.exit(1);
}

function req(method, path, body, cookies = '') {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: PORT, path, method,
      headers: {
        'Content-Type': 'application/json', Cookie: cookies,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: JSON.parse(data || '{}'),
        cookies: res.headers['set-cookie'] || [],
      }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function loginAdmin() {
  const r = await req('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert.equal(r.status, 200, `Admin login failed: ${JSON.stringify(r.body)}`);
  return r.cookies.map((c) => c.split(';')[0]).join('; ');
}

let adminCookie;
let targetUserId;

test('Admin login succeeds', async () => {
  adminCookie = await loginAdmin();
  assert.ok(adminCookie.includes('sb-access-token'));
});

test('GET /api/admin/users — returns user list with usage', async () => {
  const { status, body } = await req('GET', '/api/admin/users', null, adminCookie);
  assert.equal(status, 200, `Expected 200, got: ${JSON.stringify(body)}`);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.users));
  const user = body.users[0];
  assert.ok(typeof user.usage === 'object', 'users should have usage object');
  assert.ok(Object.prototype.hasOwnProperty.call(user, 'totalUsageCount') || Object.prototype.hasOwnProperty.call(user.usage, 'totalUsageCount'));
  // Pick a non-admin user for further tests
  const nonAdmin = body.users.find((u) => u.role === 'user');
  if (nonAdmin) targetUserId = nonAdmin.id || nonAdmin._id;
});

test('GET /api/admin/users — anonymous returns 401', async () => {
  const { status } = await req('GET', '/api/admin/users', null, '');
  assert.equal(status, 401);
});

test('GET /api/admin/users/:id — returns user details with activities', async () => {
  if (!targetUserId) { console.log('  ⚠ No target user found, skipping'); return; }
  const { status, body } = await req('GET', `/api/admin/users/${targetUserId}`, null, adminCookie);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(body.user);
  assert.ok(Array.isArray(body.activities));
});

test('POST /api/admin/block/:id — blocks a user with minutes', async () => {
  if (!targetUserId) { console.log('  ⚠ No target user found, skipping'); return; }
  const { status, body } = await req('POST', `/api/admin/block/${targetUserId}`, { minutes: 30 }, adminCookie);
  assert.equal(status, 200, `block failed: ${JSON.stringify(body)}`);
  assert.equal(body.success, true);
  assert.ok(body.blockedUntil, 'blockedUntil should be set');
});

test('POST /api/admin/unblock/:id — unblocks a user', async () => {
  if (!targetUserId) { console.log('  ⚠ No target user found, skipping'); return; }
  const { status, body } = await req('POST', `/api/admin/unblock/${targetUserId}`, null, adminCookie);
  assert.equal(status, 200);
  assert.equal(body.success, true);
});

test('POST /api/admin/role/:id — changes user role (user → admin → user)', async () => {
  if (!targetUserId) { console.log('  ⚠ No target user found, skipping'); return; }

  // Promote
  const { status: s1, body: b1 } = await req('POST', `/api/admin/role/${targetUserId}`, { role: 'admin' }, adminCookie);
  assert.equal(s1, 200);
  assert.equal(b1.user.role, 'admin');

  // Demote back
  const { status: s2, body: b2 } = await req('POST', `/api/admin/role/${targetUserId}`, { role: 'user' }, adminCookie);
  assert.equal(s2, 200);
  assert.equal(b2.user.role, 'user');
});

test('POST /api/admin/role/:id — invalid role returns 400', async () => {
  if (!targetUserId) return;
  const { status, body } = await req('POST', `/api/admin/role/${targetUserId}`, { role: 'superadmin' }, adminCookie);
  assert.equal(status, 400);
  assert.match(body.message, /invalid role/i);
});
