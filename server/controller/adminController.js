// controllers/adminController.js
const userRepo = require('../repositories/userRepo');
const usageLogRepo = require('../repositories/usageLogRepo');

async function listUsers(req, res) {
  try {
    const users = await userRepo.listAllLean();
    const userIds = users.map((user) => user.id);

    const usageLogs = await usageLogRepo.findByUserIds(userIds);

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
      const usage = usageByUser.get(String(user.id)) || {
        totalUsageCount: 0,
        videoUploadCount: 0,
        imageUploadCount: 0,
        urlPasteCount: 0,
        recentActivities: [],
      };

      return {
        ...user,
        _id: user.id,
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
    const user = await userRepo.findByIdPublic(id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const activities = await usageLogRepo.findByUserId(id);
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
        _id: user.id,
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

async function blockUser(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const { minutes, expiresAt } = body;

    const user = await userRepo.findByIdPublic(id);
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
      blockedUntil = null;
    }

    await userRepo.updateUserDoc(id, { isBlocked: true, blockedUntil });

    return res.json({ success: true, blockedUntil });
  } catch (err) {
    console.error('blockUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

async function unblockUser(req, res) {
  try {
    const { id } = req.params;
    const user = await userRepo.findByIdPublic(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    await userRepo.updateUserDoc(id, { isBlocked: false, blockedUntil: null });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

async function changeUserRole(req, res) {
  try {
    const adminId = req.user?.id;
    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    if (adminId === id) {
      return res.status(400).json({ success: false, message: 'You cannot change your own role' });
    }

    if (role === 'user') {
      const adminCount = await userRepo.countByRole('admin');
      if (adminCount <= 1) {
        return res.status(400).json({ success: false, message: 'Cannot remove the last admin' });
      }
    }

    const existing = await userRepo.findByIdPublic(id);
    if (!existing) return res.status(404).json({ success: false, message: 'User not found' });

    await userRepo.updateUserDoc(id, { role });
    const updated = await userRepo.findByIdPublic(id);

    return res.json({
      success: true,
      user: { id: updated.id, userName: updated.userName, email: updated.email, role: updated.role },
    });
  } catch (err) {
    console.error('changeUserRole error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

module.exports = { listUsers, getUserDetails, blockUser, unblockUser, changeUserRole };
