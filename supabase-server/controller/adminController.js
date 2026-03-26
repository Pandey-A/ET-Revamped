// controller/adminController.js — Supabase version
// All 5 admin functions rewritten to query profiles + usage_logs via Supabase.
// Response shapes are IDENTICAL to the old server.

const supabase = require('../lib/supabase');

// ── listUsers ─────────────────────────────────────────────────
async function listUsers(req, res) {
  try {
    const { data: users, error: usersError } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (usersError) throw usersError;

    const userIds = users.map((u) => u.id);

    const { data: usageLogs, error: logsError } = await supabase
      .from('usage_logs')
      .select('*')
      .in('user_id', userIds)
      .order('created_at', { ascending: false });

    if (logsError) throw logsError;

    // Aggregate usage per user (same logic as old adminController)
    const usageByUser = new Map();
    for (const log of usageLogs || []) {
      const key = log.user_id;
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
      if (log.service_type === 'video_upload') entry.videoUploadCount += 1;
      if (log.service_type === 'image_upload') entry.imageUploadCount += 1;
      if (log.service_type === 'url_paste') entry.urlPasteCount += 1;
      if (entry.recentActivities.length < 5) {
        entry.recentActivities.push({
          serviceType: log.service_type,
          fileName: log.file_name,
          pastedUrl: log.pasted_url,
          createdAt: log.created_at,
        });
      }
    }

    const usersWithUsage = users.map((user) => {
      const usage = usageByUser.get(user.id) || {
        totalUsageCount: 0,
        videoUploadCount: 0,
        imageUploadCount: 0,
        urlPasteCount: 0,
        recentActivities: [],
      };
      return {
        // Map snake_case Postgres columns → camelCase (same shape as old Mongoose .lean() output)
        _id: user.id,          // keep _id so existing frontend admin panel doesn't break
        id: user.id,
        userName: user.user_name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.is_email_verified,
        emailVerifiedAt: user.email_verified_at,
        analysisRequestsUsed: user.analysis_requests_used,
        analysisRequestLimit: user.analysis_request_limit,
        isBlocked: user.is_blocked,
        blockedUntil: user.blocked_until,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        usage,
      };
    });

    return res.json({ success: true, users: usersWithUsage });
  } catch (err) {
    console.error('listUsers error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── getUserDetails ────────────────────────────────────────────
async function getUserDetails(req, res) {
  try {
    const { id } = req.params;

    const { data: user, error: userError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (userError) throw userError;
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { data: activities, error: logsError } = await supabase
      .from('usage_logs')
      .select('*')
      .eq('user_id', id)
      .order('created_at', { ascending: false });

    if (logsError) throw logsError;

    const logs = activities || [];
    const usage = {
      totalUsageCount: logs.length,
      videoUploadCount: logs.filter((e) => e.service_type === 'video_upload').length,
      imageUploadCount: logs.filter((e) => e.service_type === 'image_upload').length,
      urlPasteCount: logs.filter((e) => e.service_type === 'url_paste').length,
    };

    return res.json({
      success: true,
      user: {
        _id: user.id,
        id: user.id,
        userName: user.user_name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.is_email_verified,
        emailVerifiedAt: user.email_verified_at,
        analysisRequestsUsed: user.analysis_requests_used,
        analysisRequestLimit: user.analysis_request_limit,
        isBlocked: user.is_blocked,
        blockedUntil: user.blocked_until,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        usage,
      },
      activities: logs.map((e) => ({
        serviceType: e.service_type,
        fileName: e.file_name,
        pastedUrl: e.pasted_url,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    console.error('getUserDetails error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── blockUser ─────────────────────────────────────────────────
async function blockUser(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const { minutes, expiresAt } = body;

    const { data: user, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let blockedUntil = null;
    if (expiresAt) {
      const dt = new Date(expiresAt);
      if (isNaN(dt.getTime())) return res.status(400).json({ success: false, message: 'Invalid expiresAt' });
      if (dt <= new Date()) return res.status(400).json({ success: false, message: 'expiresAt must be in the future' });
      blockedUntil = dt.toISOString();
    } else if (typeof minutes !== 'undefined') {
      const m = Number(minutes);
      if (!Number.isFinite(m) || m <= 0) return res.status(400).json({ success: false, message: 'minutes must be a positive number' });
      blockedUntil = new Date(Date.now() + m * 60000).toISOString();
    }

    await supabase
      .from('profiles')
      .update({ is_blocked: true, blocked_until: blockedUntil })
      .eq('id', id);

    return res.json({ success: true, blockedUntil });
  } catch (err) {
    console.error('blockUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── unblockUser ───────────────────────────────────────────────
async function unblockUser(req, res) {
  try {
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await supabase
      .from('profiles')
      .update({ is_blocked: false, blocked_until: null })
      .eq('id', id);

    return res.json({ success: true });
  } catch (err) {
    console.error('unblockUser error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// ── changeUserRole ────────────────────────────────────────────
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

    // Prevent removing last admin
    if (role === 'user') {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');

      if ((count || 0) <= 1) {
        return res.status(400).json({ success: false, message: 'Cannot remove the last admin' });
      }
    }

    const { data: updated, error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', id)
      .select('id, user_name, email, role')
      .maybeSingle();

    if (error) throw error;
    if (!updated) return res.status(404).json({ success: false, message: 'User not found' });

    return res.json({
      success: true,
      user: {
        id: updated.id,
        userName: updated.user_name,
        email: updated.email,
        role: updated.role,
      },
    });
  } catch (err) {
    console.error('changeUserRole error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

module.exports = { listUsers, getUserDetails, blockUser, unblockUser, changeUserRole };
