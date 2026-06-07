const crypto = require('crypto');
const { query } = require('../db/pool');

function normalizeDigits(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 ? digits : raw;
}

function maskAccessToken(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  if (t.length <= 8) return '••••••••';
  return `${t.slice(0, 4)}••••${t.slice(-4)}`;
}

function mapRow(row, { maskToken = false } = {}) {
  if (!row) return null;
  const rawToken = row.access_token || '';
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    whatsapp_business_account_id: row.whatsapp_business_account_id,
    phone_number_id: row.phone_number_id,
    display_phone_number: row.display_phone_number || '',
    access_token: maskToken ? maskAccessToken(rawToken) : rawToken,
    access_token_set: Boolean(rawToken),
    ai_agent_id: row.ai_agent_id,
    ai_agent_name: row.ai_agent_name || '',
    admin_phone: row.admin_phone || '',
    config_json: row.config_json && typeof row.config_json === 'object' ? row.config_json : {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listByOwner(ownerUserId) {
  const { rows } = await query(
    `SELECT * FROM whatsapp_channels WHERE owner_user_id = $1 ORDER BY created_at DESC`,
    [String(ownerUserId)]
  );
  return rows.map((r) => mapRow(r, { maskToken: true }));
}

async function findByIdForOwner(id, ownerUserId, { maskToken = true } = {}) {
  const { rows } = await query(
    `SELECT * FROM whatsapp_channels WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
    [String(id), String(ownerUserId)]
  );
  return mapRow(rows[0], { maskToken });
}

async function findDuplicateForCreate(wabaId, phoneNumberId) {
  const { rows } = await query(
    `SELECT * FROM whatsapp_channels
     WHERE whatsapp_business_account_id = $1 OR phone_number_id = $2
     LIMIT 1`,
    [normalizeDigits(wabaId), normalizeDigits(phoneNumberId)]
  );
  return mapRow(rows[0]);
}

async function findDuplicateForUpdate(id, wabaId, phoneNumberId) {
  const { rows } = await query(
    `SELECT * FROM whatsapp_channels
     WHERE id <> $1
       AND (whatsapp_business_account_id = $2 OR phone_number_id = $3)
     LIMIT 1`,
    [String(id), normalizeDigits(wabaId), normalizeDigits(phoneNumberId)]
  );
  return mapRow(rows[0]);
}

function normalizeConfigJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

async function createChannel(ownerUserId, payload) {
  const id = `wa_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const waba = normalizeDigits(payload.whatsapp_business_account_id);
  const phone = normalizeDigits(payload.phone_number_id);
  const configJson = normalizeConfigJson(payload.config_json);
  const { rows } = await query(
    `INSERT INTO whatsapp_channels (
      id, owner_user_id, whatsapp_business_account_id, phone_number_id, display_phone_number,
      access_token, ai_agent_id, ai_agent_name, admin_phone, config_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
    RETURNING *`,
    [
      id,
      String(ownerUserId),
      waba,
      phone,
      String(payload.display_phone_number || '').trim(),
      String(payload.access_token || '').trim(),
      String(payload.ai_agent_id || '').trim(),
      String(payload.ai_agent_name || '').trim(),
      String(payload.admin_phone || '').trim(),
      JSON.stringify(configJson),
    ]
  );
  return mapRow(rows[0]);
}

async function updateChannelForOwner(id, ownerUserId, payload) {
  const current = await findByIdForOwner(id, ownerUserId, { maskToken: false });
  if (!current) return null;
  let accessToken = payload.access_token ?? current.access_token;
  if (String(accessToken).includes('••••')) {
    accessToken = current.access_token;
  }
  const next = {
    whatsapp_business_account_id: payload.whatsapp_business_account_id ?? current.whatsapp_business_account_id,
    phone_number_id: payload.phone_number_id ?? current.phone_number_id,
    display_phone_number: payload.display_phone_number ?? current.display_phone_number,
    access_token: accessToken,
    ai_agent_id: payload.ai_agent_id ?? current.ai_agent_id,
    ai_agent_name: payload.ai_agent_name ?? current.ai_agent_name,
    admin_phone: payload.admin_phone ?? current.admin_phone,
    config_json:
      payload.config_json !== undefined
        ? normalizeConfigJson(payload.config_json)
        : normalizeConfigJson(current.config_json),
  };
  const { rows } = await query(
    `UPDATE whatsapp_channels
     SET whatsapp_business_account_id = $3,
         phone_number_id = $4,
         display_phone_number = $5,
         access_token = $6,
         ai_agent_id = $7,
         ai_agent_name = $8,
         admin_phone = $9,
         config_json = $10::jsonb,
         updated_at = now()
     WHERE id = $1 AND owner_user_id = $2
     RETURNING *`,
    [
      String(id),
      String(ownerUserId),
      normalizeDigits(next.whatsapp_business_account_id),
      normalizeDigits(next.phone_number_id),
      String(next.display_phone_number || '').trim(),
      String(next.access_token || '').trim(),
      String(next.ai_agent_id || '').trim(),
      String(next.ai_agent_name || '').trim(),
      String(next.admin_phone || '').trim(),
      JSON.stringify(next.config_json),
    ]
  );
  return mapRow(rows[0]);
}

async function deleteByIdForOwner(id, ownerUserId) {
  const r = await query(`DELETE FROM whatsapp_channels WHERE id = $1 AND owner_user_id = $2`, [
    String(id),
    String(ownerUserId),
  ]);
  return (r.rowCount || 0) > 0;
}

async function resolveForWebhook(wabaId, phoneNumberId) {
  const waba = normalizeDigits(wabaId);
  const phone = normalizeDigits(phoneNumberId);
  if (!phone) return null;
  let rows = (await query(
    `SELECT * FROM whatsapp_channels
     WHERE whatsapp_business_account_id = $1 AND phone_number_id = $2
     LIMIT 1`,
    [waba, phone]
  )).rows;
  if (rows[0]) return mapRow(rows[0]);

  // Fallback for wrong/pasted WABA: phone number id is globally unique.
  rows = (await query(`SELECT * FROM whatsapp_channels WHERE phone_number_id = $1 LIMIT 2`, [phone])).rows;
  if (rows.length === 1) return mapRow(rows[0]);
  return null;
}

async function listAllForInternal() {
  const { rows } = await query(`SELECT * FROM whatsapp_channels ORDER BY created_at DESC`);
  return rows.map((r) => mapRow(r, { maskToken: false }));
}

async function findFirstByAgentId(agentId) {
  const { rows } = await query(
    `SELECT * FROM whatsapp_channels WHERE ai_agent_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [String(agentId)]
  );
  return mapRow(rows[0]);
}

module.exports = {
  normalizeDigits,
  listByOwner,
  findByIdForOwner,
  findDuplicateForCreate,
  findDuplicateForUpdate,
  createChannel,
  updateChannelForOwner,
  deleteByIdForOwner,
  resolveForWebhook,
  findFirstByAgentId,
  listAllForInternal,
};
