// routes/auth.js
const express = require('express');
const { registerUser, loginUser, logoutUser, checkAuth, forgotPassword, verifyOtp, resetPassword} = require('../controller/controller');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.get('/check-auth', authMiddleware, checkAuth);
// existing routes...
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);


// admin-only example: promote user
router.post('/promote/:id', authMiddleware, adminOnly, async (req, res) => {
  const User = require('../models/User');
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ success: false, message: 'User not found' });
    u.role = 'admin';
    await u.save();
    res.json({ success: true, message: 'Promoted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
