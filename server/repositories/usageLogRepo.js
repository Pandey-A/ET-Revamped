const { query } = require('../db/pool');

function mapRow(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    user: row.user_id,
    serviceType: row.service_type,
    fileName: row.file_name,
    pastedUrl: row.pasted_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function create({ userId, serviceType, fileName, pastedUrl }) {
  const { rows } = await query(
    `INSERT INTO usage_logs (user_id, service_type, file_name, pasted_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [String(userId), serviceType, fileName || null, pastedUrl || null]
  );
  return mapRow(rows[0]);
}

async function findByUserIds(userIds) {
  if (!userIds.length) return [];
  const { rows } = await query(
    `SELECT * FROM usage_logs WHERE user_id = ANY($1::text[]) ORDER BY created_at DESC`,
    [userIds.map(String)]
  );
  return rows.map(mapRow);
}

async function findByUserId(userId) {
  const { rows } = await query(
    `SELECT * FROM usage_logs WHERE user_id = $1 ORDER BY created_at DESC`,
    [String(userId)]
  );
  return rows.map(mapRow);
}

module.exports = { create, findByUserIds, findByUserId, mapRow };
