// server/routers/upload.js
// Deepfake analysis routes — disabled (service not deployed)
const express = require('express');
const router = express.Router();

router.all('/analysis/*', (req, res) => {
  res.status(503).json({
    success: false,
    code: 'SERVICE_NOT_AVAILABLE',
    message: 'Deepfake analysis service is not currently available.',
  });
});

module.exports = router;
