/**
 * Apply db/schema.sql (idempotent CREATE IF NOT EXISTS).
 * Usage: from server/: `npm run db:migrate` (loads ../.env via dotenv)
 *    or: DATABASE_URL=... node db/migrate.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getPool } = require('./pool');

async function runMigrations() {
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const pool = getPool();
  await pool.query(sql);
  console.log('PostgreSQL schema applied:', sqlPath);
  await pool.end();
}

if (require.main === module) {
  runMigrations().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runMigrations };
