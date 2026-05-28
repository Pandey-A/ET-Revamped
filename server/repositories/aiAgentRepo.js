const { query } = require('../db/pool');

function mapAgentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    name: row.name,
    description: row.description,
    greeting_message: row.greeting_message,
    model: row.model,
    temperature: row.temperature != null ? Number(row.temperature) : 0.7,
    escalation_channel: row.escalation_channel,
    collection_name: row.collection_name,
    resource_list: row.resource_list || [],
    public_embed: row.public_embed,
    extra: row.extra || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toClientAgent(row) {
  const a = mapAgentRow(row);
  if (!a) return null;
  const extra = a.extra || {};
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    greeting_message: a.greeting_message,
    model: a.model,
    temperature: a.temperature,
    escalation_channel: a.escalation_channel,
    collection_name: a.collection_name,
    resource_list: a.resource_list,
    public_embed: a.public_embed,
    widget_contact_email: extra.widget_contact_email || '',
    whatsapp_contact_email: extra.whatsapp_contact_email || '',
    company_name: extra.company_name || '',
    extra,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

async function listByOwner(ownerUserId) {
  const { rows } = await query(
    `SELECT * FROM ai_agents WHERE owner_user_id = $1 ORDER BY created_at DESC`,
    [String(ownerUserId)]
  );
  return rows.map(toClientAgent);
}

async function findByIdForOwner(agentId, ownerUserId) {
  const { rows } = await query(
    `SELECT * FROM ai_agents WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
    [String(agentId), String(ownerUserId)]
  );
  return toClientAgent(rows[0]);
}

async function findById(agentId) {
  const { rows } = await query(`SELECT * FROM ai_agents WHERE id = $1 LIMIT 1`, [String(agentId)]);
  return toClientAgent(rows[0]);
}

async function insertAgent(payload) {
  const {
    id,
    owner_user_id,
    name,
    description = '',
    greeting_message = '',
    model = 'gpt-4o-mini',
    temperature = 0.7,
    escalation_channel = 'none',
    collection_name = '',
    resource_list = [],
    public_embed = true,
    extra = {},
  } = payload;

  await query(
    `INSERT INTO ai_agents (
      id, owner_user_id, name, description, greeting_message, model, temperature,
      escalation_channel, collection_name, resource_list, public_embed, extra
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb)`,
    [
      id,
      owner_user_id,
      name,
      description,
      greeting_message,
      model,
      temperature,
      escalation_channel,
      collection_name,
      JSON.stringify(resource_list),
      public_embed,
      JSON.stringify(extra),
    ]
  );
  return findById(id);
}

async function deleteByIdForOwner(agentId, ownerUserId) {
  const r = await query(`DELETE FROM ai_agents WHERE id = $1 AND owner_user_id = $2`, [String(agentId), String(ownerUserId)]);
  return (r.rowCount || 0) > 0;
}

async function updateAgentForOwner(agentId, ownerUserId, patch) {
  const current = await findByIdForOwner(agentId, ownerUserId);
  if (!current) return null;

  const name = patch.name !== undefined ? patch.name : current.name;
  const description = patch.description !== undefined ? patch.description : current.description;
  const greeting_message =
    patch.greeting_message !== undefined ? patch.greeting_message : current.greeting_message;
  const model = patch.model !== undefined ? patch.model : current.model;
  const temperature =
    patch.temperature !== undefined && Number.isFinite(Number(patch.temperature))
      ? Number(patch.temperature)
      : current.temperature;
  const escalation_channel =
    patch.escalation_channel !== undefined ? patch.escalation_channel : current.escalation_channel;
  const extra = patch.extra !== undefined ? patch.extra : current.extra || {};

  await query(
    `UPDATE ai_agents SET
      name = $3,
      description = $4,
      greeting_message = $5,
      model = $6,
      temperature = $7,
      escalation_channel = $8,
      extra = $9::jsonb,
      updated_at = now()
     WHERE id = $1 AND owner_user_id = $2`,
    [
      String(agentId),
      String(ownerUserId),
      name,
      description,
      greeting_message,
      model,
      temperature,
      escalation_channel,
      JSON.stringify(extra),
    ]
  );
  return findByIdForOwner(agentId, ownerUserId);
}

async function upsertWidgetPreset(agentId, ownerUserId, configJson) {
  await query(
    `INSERT INTO agent_widget_presets (agent_id, owner_user_id, config_json, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (agent_id) DO UPDATE SET
       config_json = EXCLUDED.config_json,
       updated_at = now()`,
    [String(agentId), String(ownerUserId), JSON.stringify(configJson)]
  );
}

async function getWidgetPreset(agentId, ownerUserId) {
  const { rows } = await query(
    `SELECT config_json FROM agent_widget_presets WHERE agent_id = $1 AND owner_user_id = $2`,
    [String(agentId), String(ownerUserId)]
  );
  return rows[0]?.config_json ?? null;
}

async function appendResourceByAgentId(agentId, resourcePath) {
  const { rows } = await query(`SELECT resource_list FROM ai_agents WHERE id = $1 LIMIT 1`, [String(agentId)]);
  if (!rows[0]) return null;
  const current = Array.isArray(rows[0].resource_list) ? rows[0].resource_list : [];
  if (current.includes(resourcePath)) {
    return findById(agentId);
  }
  const next = [...current, resourcePath];
  await query(`UPDATE ai_agents SET resource_list = $2::jsonb, updated_at = now() WHERE id = $1`, [
    String(agentId),
    JSON.stringify(next),
  ]);
  return findById(agentId);
}

module.exports = {
  listByOwner,
  findByIdForOwner,
  findById,
  insertAgent,
  deleteByIdForOwner,
  updateAgentForOwner,
  upsertWidgetPreset,
  getWidgetPreset,
  appendResourceByAgentId,
  mapAgentRow,
};
