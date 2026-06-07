// server/routers/upload.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');

// Set up Multer for handling file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '';
    // Generate a unique filename using UUID
    cb(null, `logo_${uuidv4()}${ext}`);
  }
});

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
    }
    return cb(null, true);
  },
});

// Deepfake analysis routes — disabled (service not deployed)
router.all(/^\/analysis(?:\/|$)/, (req, res) => {
  res.status(503).json({
    success: false,
    code: 'SERVICE_NOT_AVAILABLE',
    message: 'Deepfake analysis service is not currently available.',
  });
});

// Upload widget logo / WhatsApp menu images (authenticated)
router.post('/upload/logo', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // Return the relative path, frontend will attach the base URL if needed.
  // /api/uploads/ maps to the static folder we configured in server.js
  const publicUrl = `/api/uploads/${req.file.filename}`;
  
  res.json({
    success: true,
    url: publicUrl,
    message: 'Logo uploaded successfully'
  });
});

module.exports = router;
