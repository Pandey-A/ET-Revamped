// routers/upload.js — Supabase version
// Same routes, same proxy logic, same quota/rollback response shapes.
// consumeAnalysisQuota now calls the Postgres consume_analysis_quota() function.
// logUsage now inserts into usage_logs table.
// rollbackUsage calls rollback_analysis_quota() function.

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { authMiddleware, userOnly } = require('../middleware/auth');
const { createRateLimiter, singleInFlightGuard } = require('../middleware/security');

const VIDEO_ANALYSIS_BASE = process.env.VIDEO_ANALYSIS_BASE || 'http://127.0.0.1:5006';
const AUDIO_ANALYSIS_BASE = process.env.AUDIO_ANALYSIS_BASE || 'http://127.0.0.1:5000';
const URL_ANALYSIS_BASE = process.env.DEEPFAKE_ANALYSIS_BASE || 'http://127.0.0.1:5002';

const analysisBurstLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 8,
  prefix: 'analysis-burst',
  message: 'You are sending analysis requests too quickly. Please wait a bit.',
});

const singleAnalysisGuard = singleInFlightGuard({
  ttlMs: 2 * 60 * 1000,
  keyPrefix: 'analysis-single-flight',
  message: 'One analysis is already in progress for this account. Please wait for completion.',
});

function buildQuotaPayload(row) {
  return {
    analysisRequestsUsed: row.analysis_requests_used,
    analysisRequestLimit: row.analysis_request_limit,
    remainingAnalysisRequests: row.remaining,
    upgradeRequired: row.upgrade_required,
  };
}

function usageLimitResponse(quotaRow) {
  return {
    success: false,
    code: 'ANALYSIS_LIMIT_REACHED',
    message: 'You have used all 5 free analysis requests. Buy a plan to continue using this service.',
    analysisRequestsUsed: quotaRow.analysis_requests_used,
    analysisRequestLimit: quotaRow.analysis_request_limit,
    remainingAnalysisRequests: 0,
    upgradeRequired: true,
  };
}

function getForwardHeaders(req) {
  const headers = {};
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers.accept) headers.accept = req.headers.accept;
  return headers;
}

// Calls the atomic Postgres function and returns quota payload,
// or sends 403/401/500 response if limit reached / user missing.
async function consumeAnalysisQuota(req, res, next) {
  try {
    const { data, error } = await supabase.rpc('consume_analysis_quota', { p_user_id: req.user.id });

    if (error) {
      if (error.message?.includes('user_not_found')) {
        return res.status(401).json({ success: false, message: 'Unauthorised' });
      }
      console.error('consumeAnalysisQuota rpc error:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row || !row.quota_consumed) {
      // Quota exhausted — row.quota_consumed === false
      const { data: profile } = await supabase
        .from('profiles')
        .select('analysis_requests_used, analysis_request_limit')
        .eq('id', req.user.id)
        .single();

      return res.status(403).json(
        usageLimitResponse(profile || { analysis_requests_used: 5, analysis_request_limit: 5 })
      );
    }

    req.analysisQuota = {
      analysisRequestsUsed: row.analysis_requests_used,
      analysisRequestLimit: row.analysis_request_limit,
      remainingAnalysisRequests: row.remaining,
      upgradeRequired: row.upgrade_required,
    };

    return next();
  } catch (err) {
    console.error('consumeAnalysisQuota error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

async function rollbackUsage(userId) {
  try {
    await supabase.rpc('rollback_analysis_quota', { p_user_id: userId });
  } catch (err) {
    console.error('usage rollback error:', err);
  }
}

async function logUsage(req) {
  const meta = req.analysisMeta;
  if (!meta || !req.user?.id) return;
  try {
    await supabase.from('usage_logs').insert({
      user_id: req.user.id,
      service_type: meta.serviceType,
      file_name: meta.fileName || null,
      pasted_url: meta.pastedUrl || null,
    });
  } catch (err) {
    console.error('usage log error:', err);
  }
}

async function sendUpstreamResponse(upstreamResponse, res, quota) {
  const contentType = upstreamResponse.headers.get('content-type') || 'application/octet-stream';
  const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer());

  res.status(upstreamResponse.status);
  res.setHeader('Content-Type', contentType);

  if (quota) {
    res.setHeader('X-Analysis-Requests-Used', String(quota.analysisRequestsUsed));
    res.setHeader('X-Analysis-Requests-Remaining', String(quota.remainingAnalysisRequests));
  }

  if (contentType.includes('application/json')) {
    const payload = JSON.parse(responseBuffer.toString('utf8') || '{}');
    if (quota) payload.quota = quota;
    return res.json(payload);
  }

  return res.send(responseBuffer);
}

async function proxyMultipartRequest(req, res, upstreamUrl, quota) {
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getForwardHeaders(req),
      body: req,
      duplex: 'half',
    });

    if (upstreamResponse.ok) {
      await logUsage(req);
    }

    if (!upstreamResponse.ok && quota) {
      await rollbackUsage(req.user.id);
      const { data: refreshed } = await supabase
        .from('profiles')
        .select('analysis_requests_used, analysis_request_limit')
        .eq('id', req.user.id)
        .single();

      if (refreshed) {
        quota.analysisRequestsUsed = refreshed.analysis_requests_used;
        quota.remainingAnalysisRequests = Math.max(
          refreshed.analysis_request_limit - refreshed.analysis_requests_used, 0
        );
        quota.upgradeRequired = quota.remainingAnalysisRequests === 0;
      }
    }

    return await sendUpstreamResponse(upstreamResponse, res, quota);
  } catch (err) {
    if (quota) await rollbackUsage(req.user.id);
    console.error('multipart proxy error:', err);
    return res.status(502).json({ success: false, message: 'Analysis service is unavailable right now.' });
  }
}

async function proxyJsonRequest(req, res, upstreamUrl, quota) {
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(req.body || {}),
    });

    if (upstreamResponse.ok) {
      await logUsage(req);
    }

    if (!upstreamResponse.ok && quota) {
      await rollbackUsage(req.user.id);
      const { data: refreshed } = await supabase
        .from('profiles')
        .select('analysis_requests_used, analysis_request_limit')
        .eq('id', req.user.id)
        .single();

      if (refreshed) {
        quota.analysisRequestsUsed = refreshed.analysis_requests_used;
        quota.remainingAnalysisRequests = Math.max(
          refreshed.analysis_request_limit - refreshed.analysis_requests_used, 0
        );
        quota.upgradeRequired = quota.remainingAnalysisRequests === 0;
      }
    }

    return await sendUpstreamResponse(upstreamResponse, res, quota);
  } catch (err) {
    if (quota) await rollbackUsage(req.user.id);
    console.error('json proxy error:', err);
    return res.status(502).json({ success: false, message: 'Analysis service is unavailable right now.' });
  }
}

// ── Routes (identical paths) ──────────────────────────────────

router.post('/analysis/video', authMiddleware, userOnly, analysisBurstLimiter, singleAnalysisGuard, consumeAnalysisQuota, async (req, res) => {
  req.analysisMeta = { serviceType: 'video_upload', fileName: req.headers['x-upload-filename'] || null };
  return proxyMultipartRequest(req, res, `${VIDEO_ANALYSIS_BASE}/predict/video`, req.analysisQuota);
});

router.post('/analysis/image', authMiddleware, userOnly, analysisBurstLimiter, singleAnalysisGuard, consumeAnalysisQuota, async (req, res) => {
  req.analysisMeta = { serviceType: 'image_upload', fileName: req.headers['x-upload-filename'] || null };
  return proxyMultipartRequest(req, res, `${VIDEO_ANALYSIS_BASE}/predict/image`, req.analysisQuota);
});

router.post('/analysis/audio/convert', authMiddleware, userOnly, async (req, res) => {
  return proxyMultipartRequest(req, res, `${AUDIO_ANALYSIS_BASE}/convert`);
});

router.post('/analysis/audio/predict', authMiddleware, userOnly, async (req, res) => {
  return proxyMultipartRequest(req, res, `${AUDIO_ANALYSIS_BASE}/predict`);
});

router.post('/analysis/url', authMiddleware, userOnly, analysisBurstLimiter, singleAnalysisGuard, consumeAnalysisQuota, async (req, res) => {
  req.analysisMeta = { serviceType: 'url_paste', pastedUrl: req.body?.url || null };
  return proxyJsonRequest(req, res, `${URL_ANALYSIS_BASE}/deepfake-check`, req.analysisQuota);
});

module.exports = router;
