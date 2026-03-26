#!/usr/bin/env node
// scripts/validate-migration.js
// Compares record counts between MongoDB and Supabase to verify parity.
// Outputs a pass/fail table for each check.
//
// Usage:
//   MONGO_URI=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/validate-migration.js

require('dotenv').config();
const mongoose = require('mongoose');
const { createClient } = require('@supabase/supabase-js');

const MONGO_URI = process.env.MONGO_URI;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!MONGO_URI || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Required: MONGO_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const userSchema = new mongoose.Schema({ role: String, isBlocked: Boolean }, { strict: false });
const usageLogSchema = new mongoose.Schema({ serviceType: String }, { strict: false });
const User = mongoose.model('User', userSchema);
const UsageLog = mongoose.model('UsageLog', usageLogSchema);

function row(label, mongo, supa, tolerance = 0) {
  const diff = Math.abs(mongo - supa);
  const pass = diff <= tolerance;
  const status = pass ? '✅ PASS' : '❌ FAIL';
  return { label, mongo, supa, diff, status };
}

function printTable(rows) {
  const maxLabel = Math.max(...rows.map((r) => r.label.length), 5);
  const header = `${'Check'.padEnd(maxLabel)}  Mongo   Supabase  Diff  Status`;
  console.log('\n' + header);
  console.log('─'.repeat(header.length));
  for (const r of rows) {
    const label = r.label.padEnd(maxLabel);
    const m = String(r.mongo).padStart(5);
    const s = String(r.supa).padStart(8);
    const d = String(r.diff).padStart(4);
    console.log(`${label}  ${m}  ${s}  ${d}  ${r.status}`);
  }
  console.log('');
}

async function run() {
  console.log('\n🔍 Migration Validation Report\n');

  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected');

  // MongoDB counts
  const [
    mongoTotal,
    mongoAdmins,
    mongoBlocked,
    mongoVerified,
    mongoLogs,
    mongoVideoLogs,
    mongoImageLogs,
    mongoUrlLogs,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ isBlocked: true }),
    User.countDocuments({ isEmailVerified: true }),
    UsageLog.countDocuments(),
    UsageLog.countDocuments({ serviceType: 'video_upload' }),
    UsageLog.countDocuments({ serviceType: 'image_upload' }),
    UsageLog.countDocuments({ serviceType: 'url_paste' }),
  ]);

  // Supabase counts
  const [
    spTotal,
    spAdmins,
    spBlocked,
    spVerified,
    spLogs,
    spVideoLogs,
    spImageLogs,
    spUrlLogs,
  ] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).then(r => r.count || 0),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').then(r => r.count || 0),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_blocked', true).then(r => r.count || 0),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_email_verified', true).then(r => r.count || 0),
    supabase.from('usage_logs').select('id', { count: 'exact', head: true }).then(r => r.count || 0),
    supabase.from('usage_logs').select('id', { count: 'exact', head: true }).eq('service_type', 'video_upload').then(r => r.count || 0),
    supabase.from('usage_logs').select('id', { count: 'exact', head: true }).eq('service_type', 'image_upload').then(r => r.count || 0),
    supabase.from('usage_logs').select('id', { count: 'exact', head: true }).eq('service_type', 'url_paste').then(r => r.count || 0),
  ]);

  const results = [
    row('Total users',         mongoTotal,     Number(spTotal)),
    row('Admin users',         mongoAdmins,    Number(spAdmins)),
    row('Blocked users',       mongoBlocked,   Number(spBlocked)),
    row('Verified emails',     mongoVerified,  Number(spVerified)),
    row('Total usage logs',    mongoLogs,      Number(spLogs)),
    row('Video upload logs',   mongoVideoLogs, Number(spVideoLogs)),
    row('Image upload logs',   mongoImageLogs, Number(spImageLogs)),
    row('URL paste logs',      mongoUrlLogs,   Number(spUrlLogs)),
  ];

  printTable(results);

  const failures = results.filter((r) => r.status.includes('FAIL'));
  if (failures.length === 0) {
    console.log('🎉 All checks passed. Migration is consistent.\n');
  } else {
    console.log(`⚠ ${failures.length} check(s) failed. Investigate before cutting over.\n`);
  }

  await mongoose.disconnect();
  process.exit(failures.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Validation crashed:', err);
  process.exit(1);
});
