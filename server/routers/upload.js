// server/routers/upload.js
const express = require('express');
const router = express.Router();
const userRepo = require('../repositories/userRepo');
const usageLogRepo = require('../repositories/usageLogRepo');
const { authMiddleware, userOnly } = require('../middleware/auth');
const { createRateLimiter, singleInFlightGuard } = require('../middleware/security');

const VIDEO_ANALYSIS_BASE = process.env.VIDEO_ANALYSIS_BASE || 'http://103.22.140.216:5009';
const AUDIO_ANALYSIS_BASE = process.env.AUDIO_ANALYSIS_BASE || 'http://127.0.0.1:5010';
const URL_ANALYSIS_BASE = process.env.DEEPFAKE_ANALYSIS_BASE || 'http://127.0.0.1:5003';

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

function buildQuotaPayload(user) {
  const analysisRequestLimit = Number(user.analysisRequestLimit || 5);
  const analysisRequestsUsed = Number(user.analysisRequestsUsed || 0);
  const remainingAnalysisRequests = Math.max(analysisRequestLimit - analysisRequestsUsed, 0);

  return {
    analysisRequestsUsed,
    analysisRequestLimit,
    remainingAnalysisRequests,
    upgradeRequired: remainingAnalysisRequests === 0,
  };
}

function usageLimitResponse(user) {
  return {
    success: false,
    code: 'ANALYSIS_LIMIT_REACHED',
    message: 'You have used all 5 free analysis requests. Buy a plan to continue using this service.',
    ...buildQuotaPayload(user),
  };
}

function getForwardHeaders(req) {
  const headers = {};

  if (req.headers['content-type']) {
    headers['content-type'] = req.headers['content-type'];
  }

  if (req.headers.accept) {
    headers.accept = req.headers.accept;
  }

  return headers;
}

async function rollbackUsage(userId) {
  try {
    await userRepo.decrementAnalysisUsed(userId);
  } catch (err) {
    console.error('usage rollback error:', err);
  }
}

async function logUsage(req) {
  const meta = req.analysisMeta;
  if (!meta || !req.user?.id) {
    return;
  }

  try {
    await usageLogRepo.create({
      userId: req.user.id,
      serviceType: meta.serviceType,
      fileName: meta.fileName || null,
      pastedUrl: meta.pastedUrl || null,
    });
  } catch (err) {
    console.error('usage log error:', err);
  }
}

async function consumeAnalysisQuota(req, res, next) {
  try {
    const currentRow = await userRepo.selectQuotaFields(req.user.id);
    if (!currentRow) {
      return res.status(401).json({ success: false, message: 'Unauthorised' });
    }

    const analysisRequestLimit = Number(currentRow.analysis_request_limit || 5);
    let analysisRequestsUsed = Number(currentRow.analysis_requests_used || 0);

    if (currentRow.analysis_request_limit == null || currentRow.analysis_requests_used == null) {
      await userRepo.updateUserDoc(req.user.id, {
        analysisRequestLimit,
        analysisRequestsUsed,
      });
    }

    const currentUser = {
      analysisRequestLimit,
      analysisRequestsUsed,
    };

    if (analysisRequestsUsed >= analysisRequestLimit) {
      return res.status(403).json(usageLimitResponse(currentUser));
    }

    const { ok, user: updatedUser } = await userRepo.incrementAnalysisIfUnderLimit(req.user.id);

    if (!ok) {
      const latestRow = await userRepo.selectQuotaFields(req.user.id);
      const latestUser = latestRow
        ? {
            analysisRequestLimit: Number(latestRow.analysis_request_limit || 5),
            analysisRequestsUsed: Number(latestRow.analysis_requests_used || 0),
          }
        : currentUser;
      return res.status(403).json(usageLimitResponse(latestUser));
    }

    req.analysisQuota = buildQuotaPayload(updatedUser);
    return next();
  } catch (err) {
    console.error('consumeAnalysisQuota error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
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
    const payloadText = responseBuffer.toString('utf8') || '{}';
    const payload = JSON.parse(payloadText);
    if (quota) {
      payload.quota = quota;
    }
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
      const refreshedRow = await userRepo.selectQuotaFields(req.user.id);
      const used = refreshedRow != null ? Number(refreshedRow.analysis_requests_used ?? 0) : Math.max((quota.analysisRequestsUsed || 1) - 1, 0);
      const limit = refreshedRow != null ? Number(refreshedRow.analysis_request_limit ?? 5) : quota.analysisRequestLimit || 5;
      quota.analysisRequestsUsed = used;
      quota.remainingAnalysisRequests = Math.max(limit - used, 0);
      quota.upgradeRequired = quota.remainingAnalysisRequests === 0;
    }

    return await sendUpstreamResponse(upstreamResponse, res, quota);
  } catch (err) {
    if (quota) {
      await rollbackUsage(req.user.id);
    }
    console.error('multipart proxy error:', err);
    return res.status(502).json({ success: false, message: 'Analysis service is unavailable right now.' });
  }
}

async function proxyJsonRequest(req, res, upstreamUrl, quota) {
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(req.body || {}),
    });

    if (upstreamResponse.ok) {
      await logUsage(req);
    }

    if (!upstreamResponse.ok && quota) {
      await rollbackUsage(req.user.id);
      const refreshedRow = await userRepo.selectQuotaFields(req.user.id);
      const used = refreshedRow != null ? Number(refreshedRow.analysis_requests_used ?? 0) : Math.max((quota.analysisRequestsUsed || 1) - 1, 0);
      const limit = refreshedRow != null ? Number(refreshedRow.analysis_request_limit ?? 5) : quota.analysisRequestLimit || 5;
      quota.analysisRequestsUsed = used;
      quota.remainingAnalysisRequests = Math.max(limit - used, 0);
      quota.upgradeRequired = quota.remainingAnalysisRequests === 0;
    }

    return await sendUpstreamResponse(upstreamResponse, res, quota);
  } catch (err) {
    if (quota) {
      await rollbackUsage(req.user.id);
    }
    console.error('json proxy error:', err);
    return res.status(502).json({ success: false, message: 'Analysis service is unavailable right now.' });
  }
}

router.post('/analysis/video', authMiddleware, userOnly, analysisBurstLimiter, singleAnalysisGuard, consumeAnalysisQuota, async (req, res) => {
  req.analysisMeta = {
    serviceType: 'video_upload',
    fileName: req.headers['x-upload-filename'] || null,
  };
  return proxyMultipartRequest(req, res, `${VIDEO_ANALYSIS_BASE}/predict/video`, req.analysisQuota);
});

router.post('/analysis/image', authMiddleware, userOnly, analysisBurstLimiter, singleAnalysisGuard, consumeAnalysisQuota, async (req, res) => {
  req.analysisMeta = {
    serviceType: 'image_upload',
    fileName: req.headers['x-upload-filename'] || null,
  };
  return proxyMultipartRequest(req, res, `${VIDEO_ANALYSIS_BASE}/predict/image`, req.analysisQuota);
});

router.post('/analysis/audio/convert', authMiddleware, userOnly, async (req, res) => {
  return proxyMultipartRequest(req, res, `${AUDIO_ANALYSIS_BASE}/convert`);
});

router.post('/analysis/audio/predict', authMiddleware, userOnly, async (req, res) => {
  return proxyMultipartRequest(req, res, `${AUDIO_ANALYSIS_BASE}/predict`);
});

router.post('/analysis/url', authMiddleware, userOnly, analysisBurstLimiter, singleAnalysisGuard, consumeAnalysisQuota, async (req, res) => {
  req.analysisMeta = {
    serviceType: 'url_paste',
    pastedUrl: req.body?.url || null,
  };
  return proxyJsonRequest(req, res, `${URL_ANALYSIS_BASE}/deepfake-check`, req.analysisQuota);
});

module.exports = router;
