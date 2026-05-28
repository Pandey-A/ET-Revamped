const express = require('express');
const crypto = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const aiAgentRepo = require('../repositories/aiAgentRepo');

const router = express.Router();

const FASTAPI_SYNC = (process.env.FASTAPI_AGENT_SYNC_URL || process.env.AI_AGENT_API_URL || '')
  .trim()
  .replace(/\/$/, '');

function toIso(v) {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

const BEDROCK_DEFAULT_MODEL =
  (process.env.BEDROCK_DEFAULT_MODEL || 'meta.llama3-8b-instruct-v1:0').trim();

function resolveRuntimeModel(model) {
  const m = (model || '').trim();
  if (m.includes('.')) return m;
  return BEDROCK_DEFAULT_MODEL;
}

function pickContactFields(agent) {
  const extra =
    agent.extra && typeof agent.extra === 'object' && !Array.isArray(agent.extra) ? agent.extra : {};
  return {
    widget_contact_email:
      (typeof agent.widget_contact_email === 'string' && agent.widget_contact_email.trim()) ||
      (typeof extra.widget_contact_email === 'string' && extra.widget_contact_email.trim()) ||
      '',
    whatsapp_contact_email:
      (typeof agent.whatsapp_contact_email === 'string' && agent.whatsapp_contact_email.trim()) ||
      (typeof extra.whatsapp_contact_email === 'string' && extra.whatsapp_contact_email.trim()) ||
      '',
    company_name:
      (typeof agent.company_name === 'string' && agent.company_name.trim()) ||
      (typeof extra.company_name === 'string' && extra.company_name.trim()) ||
      '',
  };
}

async function syncAgentToFastapi(agent) {
  if (!FASTAPI_SYNC) return { skipped: true };
  const url = `${FASTAPI_SYNC}/store/agents`;
  const contacts = pickContactFields(agent);
  const body = {
    id: agent.id,
    owner_user_id: agent.owner_user_id,
    name: agent.name,
    description: agent.description,
    greeting_message: agent.greeting_message,
    model: resolveRuntimeModel(agent.model),
    temperature: agent.temperature,
    escalation_channel: agent.escalation_channel,
    collection_name: agent.collection_name,
    resource_list: agent.resource_list || [],
    created_at: toIso(agent.created_at),
    public_embed: agent.public_embed !== false,
    widget_contact_email: contacts.widget_contact_email,
    whatsapp_contact_email: contacts.whatsapp_contact_email,
    company_name: contacts.company_name,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!r.ok) {
    const err = new Error(data.error || data.message || `FastAPI responded ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

router.post('/agents/:id/sync-runtime', authMiddleware, async (req, res) => {
  try {
    const agent = await aiAgentRepo.findByIdForOwner(String(req.params.id), req.user.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }
    if (!FASTAPI_SYNC) {
      return res.status(503).json({
        success: false,
        message: 'AI_AGENT_API_URL / FASTAPI_AGENT_SYNC_URL is not configured',
      });
    }
    const data = await syncAgentToFastapi(agent);
    return res.json({ success: true, message: 'Agent synced to AI runtime', data });
  } catch (e) {
    console.error('sync-runtime', e);
    return res.status(e.status || 502).json({
      success: false,
      message: e.message || 'Failed to sync agent to AI runtime',
    });
  }
});

router.get('/agents', authMiddleware, async (req, res) => {
  try {
    const list = await aiAgentRepo.listByOwner(req.user.id);
    return res.json(list);
  } catch (e) {
    console.error('list agents', e);
    return res.status(500).json({ success: false, message: 'Failed to list agents' });
  }
});

router.post('/agents', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }

    const clientId = typeof body.id === 'string' ? body.id.trim() : '';
    const id =
      clientId ||
      `agent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const greeting_message = typeof body.greeting_message === 'string' ? body.greeting_message.trim() : '';
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gpt-4o-mini';
    const temperature = Number(body.temperature ?? 0.7);
    const escalation_channel =
      typeof body.escalation_channel === 'string' && body.escalation_channel.trim()
        ? body.escalation_channel.trim()
        : 'none';
    const collection_name =
      typeof body.collection_name === 'string' && body.collection_name.trim()
        ? body.collection_name.trim()
        : `${name.replace(/\s+/g, '_')}_${id}`;
    const resource_list = Array.isArray(body.resource_list) ? body.resource_list : [];
    const public_embed = body.public_embed !== false;
    const widget_contact_email =
      typeof body.widget_contact_email === 'string' ? body.widget_contact_email.trim() : '';
    const whatsapp_contact_email =
      typeof body.whatsapp_contact_email === 'string' ? body.whatsapp_contact_email.trim() : '';
    const company_name = typeof body.company_name === 'string' ? body.company_name.trim() : '';
    const extra = {
      ...(typeof body.extra === 'object' && body.extra !== null ? body.extra : {}),
      widget_contact_email,
      whatsapp_contact_email,
      company_name,
    };

    const existing = await aiAgentRepo.findById(id);
    if (existing) {
      return res.status(409).json({ success: false, message: 'An agent with this id already exists' });
    }

    await aiAgentRepo.insertAgent({
      id,
      owner_user_id: req.user.id,
      name,
      description,
      greeting_message,
      model,
      temperature: Number.isFinite(temperature) ? temperature : 0.7,
      escalation_channel,
      collection_name,
      resource_list,
      public_embed,
      extra,
    });

    const agent = await aiAgentRepo.findByIdForOwner(id, req.user.id);
    if (!agent) {
      return res.status(500).json({ success: false, message: 'Agent was not persisted' });
    }

    if (FASTAPI_SYNC) {
      try {
        await syncAgentToFastapi(agent);
      } catch (syncErr) {
        console.error('FastAPI agent sync failed:', syncErr);
        await aiAgentRepo.deleteByIdForOwner(id, req.user.id);
        return res.status(502).json({
          success: false,
          message:
            'Could not register the agent with the AI runtime. Check FASTAPI_AGENT_SYNC_URL / AI_AGENT_API_URL and that FastAPI is reachable.',
          detail: syncErr.message || String(syncErr),
        });
      }
    }

    return res.status(201).json({ success: true, agent });
  } catch (e) {
    console.error('create agent', e);
    if (e.code === '23505') {
      return res.status(409).json({ success: false, message: 'Duplicate agent id' });
    }
    return res.status(500).json({ success: false, message: 'Failed to create agent' });
  }
});

router.patch('/agents/:id', authMiddleware, async (req, res) => {
  try {
    const agentId = String(req.params.id);
    const existing = await aiAgentRepo.findByIdForOwner(agentId, req.user.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    const body = req.body || {};
    const patch = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.description === 'string') patch.description = body.description.trim();
    if (typeof body.greeting_message === 'string') patch.greeting_message = body.greeting_message.trim();
    if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model.trim();
    if (body.temperature !== undefined) patch.temperature = Number(body.temperature);
    if (typeof body.escalation_channel === 'string') patch.escalation_channel = body.escalation_channel.trim();

    const extra = { ...(existing.extra || {}) };
    if (typeof body.widget_contact_email === 'string') {
      extra.widget_contact_email = body.widget_contact_email.trim();
    }
    if (typeof body.whatsapp_contact_email === 'string') {
      extra.whatsapp_contact_email = body.whatsapp_contact_email.trim();
    }
    if (typeof body.company_name === 'string') {
      extra.company_name = body.company_name.trim();
    }
    patch.extra = extra;

    const agent = await aiAgentRepo.updateAgentForOwner(agentId, req.user.id, patch);
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    if (FASTAPI_SYNC) {
      try {
        await syncAgentToFastapi(agent);
      } catch (syncErr) {
        console.error('FastAPI agent sync failed:', syncErr);
        return res.status(502).json({
          success: false,
          message: 'Saved locally but could not sync to AI runtime.',
          detail: syncErr.message || String(syncErr),
        });
      }
    }

    return res.json({ success: true, agent });
  } catch (e) {
    console.error('patch agent', e);
    return res.status(500).json({ success: false, message: 'Failed to update agent' });
  }
});

router.delete('/agents/:id', authMiddleware, async (req, res) => {
  try {
    const ok = await aiAgentRepo.deleteByIdForOwner(String(req.params.id), req.user.id);
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('delete agent', e);
    return res.status(500).json({ success: false, message: 'Failed to delete agent' });
  }
});

router.get('/agents/:id/widget-preset', authMiddleware, async (req, res) => {
  try {
    const agentId = String(req.params.id);
    const agent = await aiAgentRepo.findByIdForOwner(agentId, req.user.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }
    const config = await aiAgentRepo.getWidgetPreset(agentId, req.user.id);
    return res.json({ success: true, config: config || {} });
  } catch (e) {
    console.error('get widget preset', e);
    return res.status(500).json({ success: false, message: 'Failed to load widget preset' });
  }
});

router.put('/agents/:id/widget-preset', authMiddleware, async (req, res) => {
  try {
    const agentId = String(req.params.id);
    const agent = await aiAgentRepo.findByIdForOwner(agentId, req.user.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }
    const config = req.body && typeof req.body.config === 'object' && req.body.config !== null ? req.body.config : req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ success: false, message: 'JSON object body (or { config }) required' });
    }
    await aiAgentRepo.upsertWidgetPreset(agentId, req.user.id, config);
    return res.json({ success: true });
  } catch (e) {
    console.error('put widget preset', e);
    return res.status(500).json({ success: false, message: 'Failed to save widget preset' });
  }
});

module.exports = router;
