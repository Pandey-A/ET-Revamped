// lib/supabase.js
// Single Supabase admin client (service_role).
// This bypasses RLS — safe to use ONLY in server-side code.
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

module.exports = supabase;
