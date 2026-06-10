'use client';

import { useEffect, useState, useRef } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";

export default function AdminPanel() {
  const { user: me } = useAuth();
  const myId = me?.id || me?._id || null;

  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalUserId, setModalUserId] = useState(null);
  const [selectedDatetime, setSelectedDatetime] = useState("");
  const [isUserDetailsOpen, setIsUserDetailsOpen] = useState(false);
  const [userDetails, setUserDetails] = useState(null);
  const [userActivities, setUserActivities] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const inputRef = useRef(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/users");
      setUsers(res.data.users || []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to fetch users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  useEffect(() => {
    document.body.style.overflow = (isModalOpen || isUserDetailsOpen) ? "hidden" : "auto";
  }, [isModalOpen, isUserDetailsOpen]);

  const changeRole = async (userId, newRole) => {
    setActionLoadingId(userId);
    try {
      const res = await api.post(`/admin/role/${userId}`, { role: newRole });
      await fetchUsers();
      toast.success(res.data?.message || `User role set to ${newRole}`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Role change failed");
    } finally { setActionLoadingId(null); }
  };

  const toggleBlock = async (userId, block) => {
    setActionLoadingId(userId);
    try {
      if (block) { await api.post(`/admin/block/${userId}`, {}); }
      else { await api.post(`/admin/unblock/${userId}`); }
      await fetchUsers();
      toast.success(block ? "User blocked" : "User unblocked");
    } catch (err) {
      toast.error(err.response?.data?.message || "Action failed");
    } finally { setActionLoadingId(null); }
  };

  const openTempBlockModal = (userId) => { setModalUserId(userId); setSelectedDatetime(""); setIsModalOpen(true); };
  const closeModal = () => { setIsModalOpen(false); setModalUserId(null); setSelectedDatetime(""); };

  const openUserDetails = async (userId) => {
    setIsUserDetailsOpen(true);
    setDetailsLoading(true);
    setUserDetails(null);
    setUserActivities([]);
    try {
      const res = await api.get(`/admin/users/${userId}`);
      setUserDetails(res.data?.user || null);
      setUserActivities(res.data?.activities || []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load user details");
      setIsUserDetailsOpen(false);
    } finally { setDetailsLoading(false); }
  };

  const closeUserDetails = () => { setIsUserDetailsOpen(false); setUserDetails(null); setUserActivities([]); };

  const submitTempBlock = async () => {
    if (!selectedDatetime) return toast.error("Please select a date and time.");
    const target = new Date(selectedDatetime);
    const now = new Date();
    if (isNaN(target.getTime()) || target <= now) return toast.error("Please choose a valid future date/time.");
    const minutes = Math.ceil((target - now) / 60000);
    setActionLoadingId(modalUserId);
    try {
      const res = await api.post(`/admin/block/${modalUserId}`, { minutes });
      toast.success(res.data?.message || `User blocked until ${target.toLocaleString()}`);
      await fetchUsers();
      closeModal();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to set block");
    } finally { setActionLoadingId(null); }
  };

  const filtered = users.filter((u) =>
    `${u.userName || ""} ${u.email || ""}`.toLowerCase().includes(q.toLowerCase())
  );

  const renderActivity = (activity) => {
    if (activity.serviceType === "video_upload") return `Video upload: ${activity.fileName || "unknown file"}`;
    if (activity.serviceType === "image_upload") return `Image upload: ${activity.fileName || "unknown file"}`;
    if (activity.serviceType === "url_paste") return `URL pasted: ${activity.pastedUrl || "unknown url"}`;
    return activity.serviceType;
  };

  return (
    <div className="admin-panel">
      <div className="admin-controls">
        <div>
          <h2 style={{ margin: 0 }}>Users</h2>
          <div className="small-muted">Manage registered users — search, block/unblock, set temporary block, change role.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="admin-search" placeholder="Search users by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={fetchUsers} className="user-action-btn" style={{ background: "#111", color: "#fff" }}>Refresh</button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 20 }}>Loading users...</div>
      ) : (
        <table className="users-table">
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Role</th><th>Usage</th>
              <th>Recent Activity</th><th>Status</th><th>Blocked Until</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 20 }}>No users found.</td></tr>
            )}
            {filtered.map((u) => (
              <tr key={u._id}>
                <td>{u.userName || "-"}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>
                  <div className="usage-summary">
                    <div>Total: {u.usage?.totalUsageCount || 0}</div>
                    <div>Video: {u.usage?.videoUploadCount || 0}</div>
                    <div>Image: {u.usage?.imageUploadCount || 0}</div>
                    <div>URL: {u.usage?.urlPasteCount || 0}</div>
                  </div>
                </td>
                <td>
                  {u.usage?.recentActivities?.length ? (
                    <ul className="usage-activity-list">
                      {u.usage.recentActivities.map((activity, index) => (
                        <li key={`${u._id}-activity-${index}`}>
                          <div>{renderActivity(activity)}</div>
                          <small>{new Date(activity.createdAt).toLocaleString()}</small>
                        </li>
                      ))}
                    </ul>
                  ) : <span className="small-muted">No usage yet</span>}
                </td>
                <td>{u.isBlocked ? <span style={{ color: "#ef4444" }}>Blocked</span> : <span style={{ color: "#10b981" }}>Active</span>}</td>
                <td>{u.blockedUntil ? new Date(u.blockedUntil).toLocaleString() : "-"}</td>
                <td className="actions-cell">
                  <div className="action-buttons" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="user-action-btn" style={{ background: "#111", color: "#fff" }} onClick={() => openUserDetails(u._id)} disabled={actionLoadingId === u._id}>View Details</button>
                    {u._id !== myId && (
                      <>
                        {u.role === "user"
                          ? <button className="user-action-btn role-btn" onClick={() => changeRole(u._id, "admin")} disabled={actionLoadingId === u._id}>Promote</button>
                          : <button className="user-action-btn role-btn" onClick={() => changeRole(u._id, "user")} disabled={actionLoadingId === u._id}>Demote</button>
                        }
                      </>
                    )}
                    {u.isBlocked ? (
                      <button className="user-action-btn unblock-btn" onClick={() => toggleBlock(u._id, false)} disabled={actionLoadingId === u._id}>Unblock</button>
                    ) : (
                      <>
                        <button className="user-action-btn block-btn" onClick={() => toggleBlock(u._id, true)} disabled={actionLoadingId === u._id}>Block</button>
                        <button className="user-action-btn role-btn" onClick={() => openTempBlockModal(u._id)} disabled={actionLoadingId === u._id}>Set Temp Block</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AnimatePresence>
        {isModalOpen && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeModal}>
            <motion.div className="modal-container" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ duration: 0.25 }} onClick={(e) => e.stopPropagation()}>
              <h3 className="modal-title">Set Temporary Block</h3>
              <p className="modal-subtext">Choose the exact date & time when this user&apos;s block should end.</p>
              <label className="modal-label">End date & time</label>
              <input ref={inputRef} type="datetime-local" className="modal-input" value={selectedDatetime} onChange={(e) => setSelectedDatetime(e.target.value)} min={new Date().toISOString().slice(0, 16)} />
              <div className="modal-actions">
                <button className="btn ghost" onClick={closeModal}>Cancel</button>
                <button className="btn primary" onClick={submitTempBlock}>Confirm</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isUserDetailsOpen && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeUserDetails}>
            <motion.div className="modal-container user-details-modal" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ duration: 0.2 }} onClick={(e) => e.stopPropagation()}>
              <h3 className="modal-title">User Details</h3>
              {detailsLoading ? (
                <p>Loading user details...</p>
              ) : userDetails ? (
                <>
                  <div className="user-details-grid">
                    <div><strong>Name:</strong> {userDetails.userName || "-"}</div>
                    <div><strong>Email:</strong> {userDetails.email || "-"}</div>
                    <div><strong>Role:</strong> {userDetails.role || "-"}</div>
                    <div><strong>Status:</strong> {userDetails.isBlocked ? "Blocked" : "Active"}</div>
                    <div><strong>Joined:</strong> {userDetails.createdAt ? new Date(userDetails.createdAt).toLocaleString() : "-"}</div>
                    <div><strong>Blocked Until:</strong> {userDetails.blockedUntil ? new Date(userDetails.blockedUntil).toLocaleString() : "-"}</div>
                    <div><strong>Total Usage:</strong> {userDetails.usage?.totalUsageCount || 0}</div>
                    <div><strong>Video Uploads:</strong> {userDetails.usage?.videoUploadCount || 0}</div>
                    <div><strong>Image Uploads:</strong> {userDetails.usage?.imageUploadCount || 0}</div>
                    <div><strong>URL Pasted:</strong> {userDetails.usage?.urlPasteCount || 0}</div>
                    <div><strong>Quota Used:</strong> {userDetails.analysisRequestsUsed || 0} / {userDetails.analysisRequestLimit || 5}</div>
                  </div>
                  <h4 className="details-subtitle">All Activities</h4>
                  {userActivities.length ? (
                    <div className="user-details-activity-wrap">
                      <table className="users-table user-details-table">
                        <thead><tr><th>Service Type</th><th>Detail</th><th>Used At</th></tr></thead>
                        <tbody>
                          {userActivities.map((activity, index) => (
                            <tr key={`activity-${index}`}>
                              <td>{activity.serviceType === "video_upload" ? "Video Upload" : activity.serviceType === "image_upload" ? "Image Upload" : "URL Paste"}</td>
                              <td>{activity.serviceType === "video_upload" || activity.serviceType === "image_upload" ? (activity.fileName || "unknown file") : (activity.pastedUrl || "unknown url")}</td>
                              <td>{new Date(activity.createdAt).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="small-muted">No activity found for this user.</p>}
                </>
              ) : <p className="small-muted">Unable to load user details.</p>}
              <div className="modal-actions">
                <button className="btn ghost" onClick={closeUserDetails}>Close</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
