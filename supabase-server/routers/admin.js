// routers/admin.js — exact copy (same paths, same middleware)
const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { listUsers, getUserDetails, blockUser, unblockUser, changeUserRole } = require('../controller/adminController');

router.get('/users', authMiddleware, adminOnly, listUsers);
router.get('/users/:id', authMiddleware, adminOnly, getUserDetails);
router.post('/block/:id', authMiddleware, adminOnly, blockUser);
router.post('/unblock/:id', authMiddleware, adminOnly, unblockUser);
router.post('/role/:id', authMiddleware, adminOnly, changeUserRole);

module.exports = router;
