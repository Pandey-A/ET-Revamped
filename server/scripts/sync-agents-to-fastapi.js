/**
 * Push all ai_agents rows from PostgreSQL to FastAPI Agents_store.json.
 * Run after deploy or DB restore: npm run agents:sync-fastapi
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getPool } = require('../db/pool');

const FASTAPI_BASE = (process.env.FASTAPI_AGENT_SYNC_URL || process.env.AI_AGENT_API_URL || '')
  .trim()
  .replace(/\/$/, '');

function toIso(v) {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

async function syncOne(agent) {
  const extra = agent.extra && typeof agent.extra === 'object' ? agent.extra : {};
  const body = {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    greeting_message: agent.greeting_message,
    model: agent.model,
    temperature: agent.temperature,
    escalation_channel: agent.escalation_channel,
    collection_name: agent.collection_name,
    resource_list: agent.resource_list || [],
    created_at: toIso(agent.created_at),
    public_embed: agent.public_embed !== false,
    widget_contact_email: extra.widget_contact_email || '',
    whatsapp_contact_email: extra.whatsapp_contact_email || '',
    company_name: extra.company_name || '',
  };
  const r = await fetch(`${FASTAPI_BASE}/store/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Agent ${agent.id}: ${r.status} ${text}`);
  }
  return agent.id;
}

async function main() {
  if (!FASTAPI_BASE) {
    console.error('Set FASTAPI_AGENT_SYNC_URL or AI_AGENT_API_URL in .env');
    process.exit(1);
  }
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, name, description, greeting_message, model, temperature,
            escalation_channel, collection_name, resource_list, public_embed, extra, created_at
     FROM ai_agents ORDER BY created_at ASC`
  );
  console.log(`Syncing ${rows.length} agent(s) to ${FASTAPI_BASE}/store/agents ...`);
  let ok = 0;
  for (const agent of rows) {
    await syncOne(agent);
    ok += 1;
    console.log('  ✓', agent.id, agent.name);
  }
  await pool.end();
  console.log(`Done. ${ok} agent(s) synced.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
