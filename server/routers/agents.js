const express = require('express');
const crypto = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const aiAgentRepo = require('../repositories/aiAgentRepo');
const { agentCreateSchema, agentPatchSchema } = require('../schemas/agentSchemas');

const router = express.Router();

const FASTAPI_SYNC = (process.env.FASTAPI_AGENT_SYNC_URL || process.env.AI_AGENT_API_URL || '')
  .trim()
  .replace(/\/$/, '');
const INTERNAL_API_KEY = (process.env.INTERNAL_API_KEY || '').trim();

function internalAllowed(req) {
  if (!INTERNAL_API_KEY) return false;
  return String(req.headers['x-internal-api-key'] || '').trim() === INTERNAL_API_KEY;
}

function toIso(v) {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

const OPENAI_DEFAULT_MODEL =
  (process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

function resolveRuntimeModel(model) {
  const m = (model || '').trim();
  if (!m) return OPENAI_DEFAULT_MODEL;
  const lower = m.toLowerCase();
  if (
    lower.startsWith('gpt-') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4') ||
    lower.startsWith('chatgpt-')
  ) {
    return m;
  }
  // Bedrock-style ids left on older agents
  if (m.includes('.')) return OPENAI_DEFAULT_MODEL;
  return m || OPENAI_DEFAULT_MODEL;
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

router.post('/internal/agents/:id/resources', async (req, res) => {
  try {
    if (!internalAllowed(req)) {
      return res.status(401).json({ success: false, message: 'Unauthorised internal request' });
    }
    const agentId = String(req.params.id || '').trim();
    const resourcePath = String(req.body?.resource_path || '').trim();
    if (!agentId || !resourcePath) {
      return res.status(400).json({ success: false, message: 'agent id and resource_path are required' });
    }
    const agent = await aiAgentRepo.appendResourceByAgentId(agentId, resourcePath);
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }
    return res.json({ success: true, agent });
  } catch (e) {
    console.error('append internal resource', e);
    return res.status(500).json({ success: false, message: 'Failed to append resource' });
  }
});

router.put('/internal/agents/:id/resources', async (req, res) => {
  try {
    if (!internalAllowed(req)) {
      return res.status(401).json({ success: false, message: 'Unauthorised internal request' });
    }
    const agentId = String(req.params.id || '').trim();
    const resourceList = req.body?.resource_list;
    if (!agentId || !Array.isArray(resourceList)) {
      return res.status(400).json({ success: false, message: 'agent id and resource_list array are required' });
    }
    const agent = await aiAgentRepo.setResourceListByAgentId(agentId, resourceList);
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }
    return res.json({ success: true, agent });
  } catch (e) {
    console.error('set internal resources', e);
    return res.status(500).json({ success: false, message: 'Failed to set resources' });
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

router.post('/agents', authMiddleware, validateBody(agentCreateSchema), async (req, res) => {
  try {
    const body = req.body || {};
    const name = body.name;

    const clientId = body.id || '';
    const id =
      clientId ||
      `agent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const description = body.description || '';
    const greeting_message = body.greeting_message || '';
    const model = body.model || 'gpt-4o-mini';
    const temperature = Number(body.temperature ?? 0.7);
    const escalation_channel = 'none';
    const collection_name =
      body.collection_name ||
      `${name.replace(/\s+/g, '_')}_${id}`;
    const resource_list = body.resource_list || [];
    const public_embed = body.public_embed !== false;
    const widget_contact_email = body.widget_contact_email || '';
    const whatsapp_contact_email = body.whatsapp_contact_email || '';
    const company_name = body.company_name || '';
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

router.patch('/agents/:id', authMiddleware, validateBody(agentPatchSchema), async (req, res) => {
  try {
    const agentId = String(req.params.id);
    const existing = await aiAgentRepo.findByIdForOwner(agentId, req.user.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    const body = req.body || {};
    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.greeting_message !== undefined) patch.greeting_message = body.greeting_message;
    if (body.model !== undefined) patch.model = body.model;
    if (body.temperature !== undefined) patch.temperature = Number(body.temperature);

    const extra = { ...(existing.extra || {}) };
    if (body.widget_contact_email !== undefined) {
      extra.widget_contact_email = body.widget_contact_email;
    }
    if (body.whatsapp_contact_email !== undefined) {
      extra.whatsapp_contact_email = body.whatsapp_contact_email;
    }
    if (body.company_name !== undefined) {
      extra.company_name = body.company_name;
    }
    patch.extra = extra;

    let agent = await aiAgentRepo.updateAgentForOwner(agentId, req.user.id, patch);
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    if (body.resource_list !== undefined) {
      agent = await aiAgentRepo.setResourceListForOwner(
        agentId,
        req.user.id,
        body.resource_list
      );
      if (!agent) {
        return res.status(404).json({ success: false, message: 'Agent not found' });
      }
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
