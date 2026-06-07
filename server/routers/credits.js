const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const creditRepo = require('../repositories/creditRepo');

const router = express.Router();

const FASTAPI_BASE = (process.env.FASTAPI_AGENT_SYNC_URL || process.env.AI_AGENT_API_URL || '')
  .trim()
  .replace(/\/$/, '');

async function fetchBillingFromFastapi(userId) {
  if (!FASTAPI_BASE) {
    const err = new Error('AI_AGENT_API_URL is not configured');
    err.status = 503;
    throw err;
  }
  const url = `${FASTAPI_BASE}/credits/billing?user_id=${encodeURIComponent(userId)}`;
  const r = await fetch(url);
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!r.ok) {
    const err = new Error(data.detail || data.error || `FastAPI responded ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

router.get('/credits/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const data = await fetchBillingFromFastapi(userId);

    if (data.billing) {
      await creditRepo.upsertAccountSnapshot(userId, data.billing);
    }

    return res.json(data);
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message || 'Failed to load credits' });
  }
});

router.get('/credits/tokens', authMiddleware, async (req, res) => {
  try {
    if (!FASTAPI_BASE) {
      return res.status(503).json({ error: 'AI_AGENT_API_URL is not configured' });
    }
    const userId = req.user.id;
    const url = `${FASTAPI_BASE}/credits/tokens?user_id=${encodeURIComponent(userId)}`;
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        error: data.detail || data.error || `FastAPI responded ${r.status}`,
      });
    }
    return res.json({ user_id: userId, token_usage_per_session: data });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to load token usage' });
  }
});

module.exports = router;
