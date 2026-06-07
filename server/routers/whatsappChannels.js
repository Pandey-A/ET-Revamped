const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');
const aiAgentRepo = require('../repositories/aiAgentRepo');
const repo = require('../repositories/whatsappChannelRepo');

const router = express.Router();

// Temporary: fixed BCA image on every broadcast (same file as HR-Reachout-Agent-main/temp_files/)
const HARDCODED_BROADCAST_IMAGE = path.join(
  __dirname,
  '..',
  'uploads',
  'ssquare-broadcast-bca.png',
);

function attachHardcodedBroadcastImage(payload) {
  if (process.env.WHATSAPP_BROADCAST_HARDCODED_IMAGE === '0') return;
  if (!fs.existsSync(HARDCODED_BROADCAST_IMAGE)) return;
  payload.image_path = HARDCODED_BROADCAST_IMAGE;
  payload.image_url = payload.image_url || '/api/uploads/ssquare-broadcast-bca.png';
  try {
    const buf = fs.readFileSync(HARDCODED_BROADCAST_IMAGE);
    if (buf.length && buf.length <= 5 * 1024 * 1024) {
      payload.image_base64 = buf.toString('base64');
      payload.image_mime = 'image/png';
    }
  } catch (e) {
    console.error('hardcoded broadcast image read failed', e);
  }
}

const broadcastImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.png';
      cb(null, `broadcast_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype || '')) return cb(null, true);
    return cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
  },
});

function resolveBroadcastImageLocalPath(imageUrl) {
  let ref = String(imageUrl || '').trim();
  if (!ref) return '';
  try {
    if (/^https?:\/\//i.test(ref)) {
      ref = new URL(ref).pathname;
    }
  } catch (_) {
    return '';
  }
  const marker = '/api/uploads/';
  const idx = ref.indexOf(marker);
  const fileName = idx >= 0 ? ref.slice(idx + marker.length) : path.basename(ref);
  if (!fileName) return '';
  const local = path.join(__dirname, '..', 'uploads', path.basename(fileName));
  return fs.existsSync(local) ? local : '';
}

function buildBroadcastImagePublicUrl(req, imageUrl) {
  const ref = String(imageUrl || '').trim();
  if (!ref) return '';
  if (/^https?:\/\//i.test(ref)) return ref;
  const base = `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
  return ref.startsWith('/') ? `${base}${ref}` : `${base}/${ref}`;
}

function internalAllowed(req) {
  const configured = String(process.env.INTERNAL_API_KEY || '').trim();
  if (!configured) return false;
  const provided = String(req.headers['x-internal-api-key'] || '').trim();
  return provided && provided === configured;
}

function formatBroadcastApiError(data, status) {
  const detail = data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
  }
  if (typeof detail === 'string') return detail;
  return data?.error || data?.message || `Broadcast request failed (HTTP ${status})`;
}

router.post('/whatsapp-channels/:id/broadcast/preview', authMiddleware, async (req, res) => {
  try {
    const channelId = String(req.params.id || '').trim();
    const channel = await repo.findByIdForOwner(channelId, req.user.id, { maskToken: false });
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }
    const internalKey = String(process.env.INTERNAL_API_KEY || '').trim();
    if (!internalKey) {
      return res.status(500).json({
        success: false,
        message: 'Server INTERNAL_API_KEY is not set — broadcast cannot reach the AI service.',
      });
    }
    const audience = String(req.body?.audience || 'manual').trim().toLowerCase();
    let phones = req.body?.phones;
    if (typeof phones === 'string') {
      phones = phones.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
    }
    if (!Array.isArray(phones)) phones = [];

    const fastapiBase = (process.env.AI_AGENT_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const r = await fetch(`${fastapiBase}/internal/whatsapp/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': internalKey,
      },
      body: JSON.stringify({
        phone_number_id: channel.phone_number_id,
        access_token: channel.access_token,
        message: 'preview',
        audience,
        phones,
        agent_id: channel.ai_agent_id || '',
        dry_run: true,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        success: false,
        message: formatBroadcastApiError(data, r.status),
      });
    }
    return res.json({ success: true, ...data });
  } catch (e) {
    console.error('whatsapp broadcast preview', e);
    return res.status(500).json({
      success: false,
      message: e.message?.includes('fetch') 
        ? 'Cannot reach AI service (FastAPI). Is it running on port 8000?'
        : 'Failed to preview broadcast recipients',
    });
  }
});

router.post(
  '/whatsapp-channels/:id/broadcast',
  authMiddleware,
  (req, res, next) => {
    broadcastImageUpload.single('image')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message || 'Invalid image file' });
      }
      return next();
    });
  },
  async (req, res) => {
  try {
    const internalKey = String(process.env.INTERNAL_API_KEY || '').trim();
    if (!internalKey) {
      return res.status(500).json({
        success: false,
        message: 'Server INTERNAL_API_KEY is not set — restart the API server after updating .env.',
      });
    }

    const channelId = String(req.params.id || '').trim();
    const channel = await repo.findByIdForOwner(channelId, req.user.id, { maskToken: false });
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }
    if (!channel.access_token) {
      return res.status(400).json({ success: false, message: 'Channel access token is missing' });
    }

    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ success: false, message: 'message is required' });
    }

    const audience = String(req.body?.audience || 'manual').trim().toLowerCase();
    let phones = req.body?.phones;
    if (typeof phones === 'string') {
      phones = phones
        .split(/[\n,;]+/)
        .map((p) => p.trim())
        .filter(Boolean);
    }
    if (!Array.isArray(phones)) phones = [];

    if (audience === 'manual' && phones.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Add at least one phone number or choose Leads / All contacts audience.',
      });
    }

    const imageUrl = String(req.body?.image_url || '').trim();
    let imagePath = req.file?.path || resolveBroadcastImageLocalPath(imageUrl);
    const imagePublicUrl = buildBroadcastImagePublicUrl(req, imageUrl || (req.file ? `/api/uploads/${path.basename(imagePath)}` : ''));

    const fastapiPayload = {
      phone_number_id: channel.phone_number_id,
      access_token: channel.access_token,
      admin_phone: channel.admin_phone || '',
      message,
      audience,
      phones,
      agent_id: channel.ai_agent_id || '',
      image_url: imageUrl,
      image_path: imagePath || '',
      image_public_url: imagePublicUrl,
    };
    if (!imagePath || !fs.existsSync(imagePath)) {
      const ref = imageUrl ? resolveBroadcastImageLocalPath(imageUrl) : '';
      if (ref && fs.existsSync(ref)) {
        imagePath = ref;
        fastapiPayload.image_path = ref;
      }
    }
    // Always send base64 when we have a local file so FastAPI works even if paths differ between processes
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        const buf = fs.readFileSync(imagePath);
        if (buf.length && buf.length <= 5 * 1024 * 1024) {
          fastapiPayload.image_base64 = buf.toString('base64');
          const ext = path.extname(imagePath).toLowerCase();
          const mimeByExt = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.gif': 'image/gif',
          };
          fastapiPayload.image_mime =
            mimeByExt[ext] || (req.file?.mimetype || 'image/jpeg');
        }
      } catch (readErr) {
        console.error('broadcast image read failed', readErr);
      }
    }

    attachHardcodedBroadcastImage(fastapiPayload);

    const fastapiBase = (process.env.AI_AGENT_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const r = await fetch(`${fastapiBase}/internal/whatsapp/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': internalKey,
      },
      body: JSON.stringify(fastapiPayload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        success: false,
        message: formatBroadcastApiError(data, r.status),
        ...data,
      });
    }
    const ok = Boolean(data.success) || ((data.sent ?? 0) > 0 && !data.image_requested);
    return res.json({ success: ok, ...data });
  } catch (e) {
    console.error('whatsapp broadcast', e);
    const msg = String(e?.message || e);
    return res.status(500).json({
      success: false,
      message: msg.includes('fetch')
        ? `Cannot reach AI service at ${process.env.AI_AGENT_API_URL || 'http://127.0.0.1:8000'}. Start FastAPI on port 8000.`
        : 'Failed to send broadcast',
    });
  }
  }
);

router.post('/whatsapp-channels/bca-reminders/test', authMiddleware, async (req, res) => {
  try {
    const fastapiBase = (process.env.AI_AGENT_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const force = req.query.force === '1' || req.query.force === 'true';
    const r = await fetch(`${fastapiBase}/internal/whatsapp/bca-reminders/run?force=${force ? '1' : '0'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': String(process.env.INTERNAL_API_KEY || '').trim(),
      },
    });
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (e) {
    console.error('bca reminders proxy', e);
    return res.status(500).json({ success: false, message: 'Failed to run BCA reminders' });
  }
});

router.get('/whatsapp-channels/internal/all', async (req, res) => {
  try {
    if (!internalAllowed(req)) {
      return res.status(401).json({ success: false, message: 'Unauthorised internal request' });
    }
    const channels = await repo.listAllForInternal();
    return res.json({ success: true, channels });
  } catch (e) {
    console.error('list internal channels', e);
    return res.status(500).json({ success: false, message: 'Failed to list channels' });
  }
});

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
