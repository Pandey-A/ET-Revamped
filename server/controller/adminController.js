// controllers/adminController.js
const User = require('../models/User');
const UsageLog = require('../models/usageLog');

async function listUsers(req, res) {
  try {
    const users = await User.find().select('-password').lean();
    const userIds = users.map((user) => user._id);

    const usageLogs = await UsageLog.find({ user: { $in: userIds } })
      .sort({ createdAt: -1 })
      .lean();

    const usageByUser = new Map();
    for (const log of usageLogs) {
      const key = String(log.user);
      if (!usageByUser.has(key)) {
        usageByUser.set(key, {
          totalUsageCount: 0,
          videoUploadCount: 0,
          imageUploadCount: 0,
          urlPasteCount: 0,
          recentActivities: [],
        });
      }

      const entry = usageByUser.get(key);
      entry.totalUsageCount += 1;

      if (log.serviceType === 'video_upload') {
        entry.videoUploadCount += 1;
      }

      if (log.serviceType === 'image_upload') {
        entry.imageUploadCount += 1;
      }

      if (log.serviceType === 'url_paste') {
        entry.urlPasteCount += 1;
      }

      if (entry.recentActivities.length < 5) {
        entry.recentActivities.push({
          serviceType: log.serviceType,
          fileName: log.fileName,
          pastedUrl: log.pastedUrl,
          createdAt: log.createdAt,
        });
      }
    }

    const usersWithUsage = users.map((user) => {
      const usage = usageByUser.get(String(user._id)) || {
        totalUsageCount: 0,
        videoUploadCount: 0,
        imageUploadCount: 0,
        urlPasteCount: 0,
        recentActivities: [],
      };

      return {
        ...user,
        usage,
      };
    });

    return res.json({ success: true, users: usersWithUsage });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

async function getUserDetails(req, res) {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select('-password').lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const activities = await UsageLog.find({ user: id }).sort({ createdAt: -1 }).lean();
    const usage = {
      totalUsageCount: activities.length,
      videoUploadCount: activities.filter((entry) => entry.serviceType === 'video_upload').length,
      imageUploadCount: activities.filter((entry) => entry.serviceType === 'image_upload').length,
      urlPasteCount: activities.filter((entry) => entry.serviceType === 'url_paste').length,
    };

    return res.json({
      success: true,
      user: {
        ...user,
        usage,
      },
      activities: activities.map((entry) => ({
        serviceType: entry.serviceType,
        fileName: entry.fileName,
        pastedUrl: entry.pastedUrl,
        createdAt: entry.createdAt,
      })),
    });
  } catch (err) {
    console.error('getUserDetails error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// controllers/adminController.js
async function blockUser(req, res) {
  try {
    const { id } = req.params;
    // Defensive: ensure req.body is an object so destructuring won't throw
    const body = req.body || {};
    const { minutes, expiresAt } = body;

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let blockedUntil = null;
    if (expiresAt) {
      const dt = new Date(expiresAt);
      if (isNaN(dt.getTime())) return res.status(400).json({ success: false, message: 'Invalid expiresAt' });
      if (dt <= new Date()) return res.status(400).json({ success: false, message: 'expiresAt must be in the future' });
      blockedUntil = dt;
    } else if (typeof minutes !== 'undefined') {
      const m = Number(minutes);
      if (!Number.isFinite(m) || m <= 0) return res.status(400).json({ success: false, message: 'minutes must be a positive number' });
      blockedUntil = new Date(Date.now() + m * 60000);
    } else {
      // no body -> indefinite block (blockedUntil stays null)
      blockedUntil = null;
    }

    user.isBlocked = true;
    user.blockedUntil = blockedUntil;
    await user.save();

    return res.json({ success: true, blockedUntil });
  } catch (err) {
    console.error('blockUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}


async function unblockUser(req, res) {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isBlocked = false;
    user.blockedUntil = null;
    await user.save();
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// controllers/adminController.js (append)

async function changeUserRole(req, res) {
    try {
      const adminId = req.user?.id; // id of the admin making the request (authMiddleware sets req.user)
      const { id } = req.params; // target user id
      const { role } = req.body; // expected 'user' or 'admin'
  
      if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ success: false, message: 'Invalid role' });
      }
  
      // prevent admin from changing their own role (avoid accidental lockout)
      if (adminId === id) {
        return res.status(400).json({ success: false, message: 'You cannot change your own role' });
      }
  
      const User = require('../models/User');
  
      // If demoting an admin, ensure there will still be at least one admin left
      if (role === 'user') {
        const adminCount = await User.countDocuments({ role: 'admin' });
        if (adminCount <= 1) {
          return res.status(400).json({ success: false, message: 'Cannot remove the last admin' });
        }
      }
  
      const updated = await User.findByIdAndUpdate(id, { $set: { role } }, { new: true, select: '-password' });
      if (!updated) return res.status(404).json({ success: false, message: 'User not found' });
  
      return res.json({ success: true, user: { id: updated._id, userName: updated.userName, email: updated.email, role: updated.role } });
    } catch (err) {
      console.error('changeUserRole error:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
  
  module.exports = { listUsers, getUserDetails, blockUser, unblockUser, changeUserRole }; // include new export
  


