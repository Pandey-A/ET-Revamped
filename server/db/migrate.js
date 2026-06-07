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
  const pool = getPool();
  const sqlPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('PostgreSQL schema applied:', sqlPath);

  const migrationsDir = path.join(__dirname, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const migPath = path.join(migrationsDir, file);
      const migSql = fs.readFileSync(migPath, 'utf8');
      await pool.query(migSql);
      console.log('Migration applied:', migPath);
    }
  }

  await pool.end();
}

if (require.main === module) {
  runMigrations().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runMigrations };
