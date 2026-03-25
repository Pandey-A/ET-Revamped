// server/routers/upload.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const UsageLog = require('../models/usageLog');
const { authMiddleware, userOnly } = require('../middleware/auth');

const VIDEO_ANALYSIS_BASE = process.env.VIDEO_ANALYSIS_BASE || 'http://103.22.140.216:5009';
const AUDIO_ANALYSIS_BASE = process.env.AUDIO_ANALYSIS_BASE || 'http://127.0.0.1:5000';
const URL_ANALYSIS_BASE = process.env.DEEPFAKE_ANALYSIS_BASE || 'http://127.0.0.1:5002';

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
    await User.findByIdAndUpdate(userId, { $inc: { analysisRequestsUsed: -1 } });
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
    await UsageLog.create({
      user: req.user.id,
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
    const currentUser = await User.findById(req.user.id).select('analysisRequestsUsed analysisRequestLimit');
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'Unauthorised' });
    }

    const analysisRequestLimit = Number(currentUser.analysisRequestLimit || 5);
    const analysisRequestsUsed = Number(currentUser.analysisRequestsUsed || 0);

    if (currentUser.analysisRequestLimit == null || currentUser.analysisRequestsUsed == null) {
      await User.updateOne(
        { _id: req.user.id },
        {
          $set: {
            analysisRequestLimit,
            analysisRequestsUsed,
          },
        }
      );
      currentUser.analysisRequestLimit = analysisRequestLimit;
      currentUser.analysisRequestsUsed = analysisRequestsUsed;
    }

    if (analysisRequestsUsed >= analysisRequestLimit) {
      return res.status(403).json(usageLimitResponse(currentUser));
    }

    const updatedUser = await User.findOneAndUpdate(
      {
        _id: req.user.id,
        analysisRequestsUsed: { $lt: analysisRequestLimit },
      },
      { $inc: { analysisRequestsUsed: 1 } },
      {
        new: true,
        select: 'analysisRequestsUsed analysisRequestLimit',
      }
    );

    if (!updatedUser) {
      const latestUser = await User.findById(req.user.id).select('analysisRequestsUsed analysisRequestLimit');
      return res.status(403).json(usageLimitResponse(latestUser || currentUser));
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
      const refreshedUser = await User.findById(req.user.id).select('analysisRequestsUsed analysisRequestLimit');
      quota.analysisRequestsUsed = refreshedUser?.analysisRequestsUsed ?? Math.max((quota.analysisRequestsUsed || 1) - 1, 0);
      quota.remainingAnalysisRequests = refreshedUser
        ? Math.max((refreshedUser.analysisRequestLimit || 5) - (refreshedUser.analysisRequestsUsed || 0), 0)
        : Math.max((quota.analysisRequestLimit || 5) - (quota.analysisRequestsUsed || 0), 0);
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
      const refreshedUser = await User.findById(req.user.id).select('analysisRequestsUsed analysisRequestLimit');
      quota.analysisRequestsUsed = refreshedUser?.analysisRequestsUsed ?? Math.max((quota.analysisRequestsUsed || 1) - 1, 0);
      quota.remainingAnalysisRequests = refreshedUser
        ? Math.max((refreshedUser.analysisRequestLimit || 5) - (refreshedUser.analysisRequestsUsed || 0), 0)
        : Math.max((quota.analysisRequestLimit || 5) - (quota.analysisRequestsUsed || 0), 0);
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

router.post('/analysis/video', authMiddleware, userOnly, consumeAnalysisQuota, async (req, res) => {
  req.analysisMeta = {
    serviceType: 'video_upload',
    fileName: req.headers['x-upload-filename'] || null,
  };
  return proxyMultipartRequest(req, res, `${VIDEO_ANALYSIS_BASE}/predict/video`, req.analysisQuota);
});

router.post('/analysis/image', authMiddleware, userOnly, consumeAnalysisQuota, async (req, res) => {
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

// ─── URL Analysis: download via yt-dlp → forward to video model ────────────
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');


function downloadVideoFromUrl(url) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfurl-'));
    const outputTemplate = path.join(tmpDir, '%(id)s.%(ext)s');

    const args = [
      '--no-playlist',
      '--max-filesize', '100M',
      '-f', 'mp4/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      url,
    ];

    execFile('yt-dlp', args, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        // Cleanup on error
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        return reject(new Error(stderr || err.message || 'yt-dlp failed'));
      }

      // Find the downloaded file
      const files = fs.readdirSync(tmpDir);
      const videoFile = files.find(f => /\.(mp4|mkv|webm|avi|mov)$/i.test(f));
      if (!videoFile) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        return reject(new Error('yt-dlp did not produce a video file'));
      }

      resolve({ filePath: path.join(tmpDir, videoFile), tmpDir, fileName: videoFile });
    });
  });
}

router.post('/analysis/url', authMiddleware, userOnly, consumeAnalysisQuota, async (req, res) => {
  const url = req.body?.url;
  if (!url) {
    return res.status(400).json({ success: false, message: 'URL is required.' });
  }

  req.analysisMeta = {
    serviceType: 'url_paste',
    pastedUrl: url,
  };

  let downloadInfo = null;

  try {
    // 1. Download video from URL
    downloadInfo = await downloadVideoFromUrl(url);

    // 2. Read file into buffer, use web-standard FormData + Blob
    const fileBuffer = fs.readFileSync(downloadInfo.filePath);
    const blob = new Blob([fileBuffer], { type: 'video/mp4' });
    const form = new FormData();
    form.append('video', blob, downloadInfo.fileName);

    const analysisResponse = await fetch(`${VIDEO_ANALYSIS_BASE}/predict/video`, {
      method: 'POST',
      body: form,
    });

    if (!analysisResponse.ok) {
      // Rollback quota on upstream failure
      await rollbackUsage(req.user.id);
      const refreshedUser = await User.findById(req.user.id).select('analysisRequestsUsed analysisRequestLimit');
      const quota = buildQuotaPayload(refreshedUser);
      const errText = await analysisResponse.text().catch(() => 'Analysis model error');
      return res.status(analysisResponse.status).json({
        success: false,
        message: errText,
        quota,
      });
    }

    const result = await analysisResponse.json();
    result.quota = req.analysisQuota;
    await logUsage(req);

    return res.json(result);
  } catch (err) {
    // Rollback quota
    await rollbackUsage(req.user.id);
    console.error('URL analysis error:', err.message);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to download or analyze the video from URL.',
    });
  } finally {
    // Always cleanup temp files
    if (downloadInfo?.tmpDir) {
      try { fs.rmSync(downloadInfo.tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
});

module.exports = router;
