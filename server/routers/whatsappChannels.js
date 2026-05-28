const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const aiAgentRepo = require('../repositories/aiAgentRepo');
const repo = require('../repositories/whatsappChannelRepo');

const router = express.Router();

function internalAllowed(req) {
  const configured = String(process.env.INTERNAL_API_KEY || '').trim();
  if (!configured) return false;
  const provided = String(req.headers['x-internal-api-key'] || '').trim();
  return provided && provided === configured;
}

router.get('/whatsapp-channels/internal/resolve', async (req, res) => {
  try {
    if (!internalAllowed(req)) {
      return res.status(401).json({ success: false, message: 'Unauthorised internal request' });
    }
    const waba = String(req.query.waba_id || '');
    const phone = String(req.query.phone_number_id || '');
    const row = await repo.resolveForWebhook(waba, phone);
    return res.json({ success: true, channel: row || null });
  } catch (e) {
    console.error('resolve webhook channel', e);
    return res.status(500).json({ success: false, message: 'Failed to resolve channel' });
  }
});

router.get('/whatsapp-channels/internal/by-agent/:agentId', async (req, res) => {
  try {
    if (!internalAllowed(req)) {
      return res.status(401).json({ success: false, message: 'Unauthorised internal request' });
    }
    const row = await repo.findFirstByAgentId(String(req.params.agentId || ''));
    return res.json({ success: true, channel: row || null });
  } catch (e) {
    console.error('resolve by agent channel', e);
    return res.status(500).json({ success: false, message: 'Failed to resolve channel by agent' });
  }
});

router.get('/whatsapp-channels', authMiddleware, async (req, res) => {
  try {
    const list = await repo.listByOwner(req.user.id);
    return res.json({ success: true, channels: list });
  } catch (e) {
    console.error('list whatsapp channels', e);
    return res.status(500).json({ success: false, message: 'Failed to list channels' });
  }
});

router.post('/whatsapp-channels', authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const waba = repo.normalizeDigits(body.whatsapp_business_account_id);
    const phone = repo.normalizeDigits(body.phone_number_id);
    const token = String(body.access_token || '').trim();
    const agentId = String(body.ai_agent_id || '').trim();
    if (!waba || !phone || !token || !agentId) {
      return res.status(400).json({
        success: false,
        message: 'whatsapp_business_account_id, phone_number_id, access_token, ai_agent_id are required',
      });
    }
    const ownedAgent = await aiAgentRepo.findByIdForOwner(agentId, req.user.id);
    if (!ownedAgent) {
      return res.status(400).json({ success: false, message: 'Selected AI agent is not owned by current user' });
    }
    const duplicate = await repo.findDuplicateForCreate(waba, phone);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message:
          duplicate.phone_number_id === phone
            ? 'This phone number id already exists. Please try new credentials.'
            : 'This WhatsApp business account id already exists. Please try new credentials.',
      });
    }
    const created = await repo.createChannel(req.user.id, {
      ...body,
      whatsapp_business_account_id: waba,
      phone_number_id: phone,
      ai_agent_name: String(body.ai_agent_name || ownedAgent.name || '').trim(),
    });
    return res.status(201).json({ success: true, channel: created });
  } catch (e) {
    console.error('create whatsapp channel', e);
    if (e.code === '23505') {
      return res.status(409).json({ success: false, message: 'Channel already exists for this credential' });
    }
    return res.status(500).json({ success: false, message: 'Failed to create channel' });
  }
});

router.put('/whatsapp-channels/:id', authMiddleware, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const current = await repo.findByIdForOwner(id, req.user.id);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }
    const body = req.body || {};
    const nextWaba = repo.normalizeDigits(body.whatsapp_business_account_id ?? current.whatsapp_business_account_id);
    const nextPhone = repo.normalizeDigits(body.phone_number_id ?? current.phone_number_id);
    const nextAgent = String(body.ai_agent_id ?? current.ai_agent_id).trim();
    if (!nextWaba || !nextPhone || !nextAgent) {
      return res.status(400).json({ success: false, message: 'Invalid channel payload' });
    }
    const ownedAgent = await aiAgentRepo.findByIdForOwner(nextAgent, req.user.id);
    if (!ownedAgent) {
      return res.status(400).json({ success: false, message: 'Selected AI agent is not owned by current user' });
    }
    const duplicate = await repo.findDuplicateForUpdate(id, nextWaba, nextPhone);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message:
          duplicate.phone_number_id === nextPhone
            ? 'This phone number id already exists. Please try new credentials.'
            : 'This WhatsApp business account id already exists. Please try new credentials.',
      });
    }
    const updated = await repo.updateChannelForOwner(id, req.user.id, {
      ...body,
      whatsapp_business_account_id: nextWaba,
      phone_number_id: nextPhone,
      ai_agent_name: String(body.ai_agent_name || ownedAgent.name || '').trim(),
    });
    return res.json({ success: true, channel: updated });
  } catch (e) {
    console.error('update whatsapp channel', e);
    return res.status(500).json({ success: false, message: 'Failed to update channel' });
  }
});

router.delete('/whatsapp-channels/:id', authMiddleware, async (req, res) => {
  try {
    const ok = await repo.deleteByIdForOwner(String(req.params.id || ''), req.user.id);
    if (!ok) return res.status(404).json({ success: false, message: 'Channel not found' });
    return res.json({ success: true });
  } catch (e) {
    console.error('delete whatsapp channel', e);
    return res.status(500).json({ success: false, message: 'Failed to delete channel' });
  }
});

module.exports = router;
