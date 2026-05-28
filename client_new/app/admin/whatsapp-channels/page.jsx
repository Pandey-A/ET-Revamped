'use client';

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ToastContainer, toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import "react-toastify/dist/ReactToastify.css";
import { getApiBaseUrl } from "@/lib/api";
import { getAuthHeaderObject } from "@/lib/authToken";

const API_BASE = getApiBaseUrl();

async function syncAgentToRuntime(agentId) {
  if (!agentId) return;
  try {
    const res = await fetch(`${getApiBaseUrl()}/agents/${encodeURIComponent(agentId)}/sync-runtime`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...getAuthHeaderObject() },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("Agent runtime sync:", body.message || res.status);
    }
  } catch (e) {
    console.warn("Agent runtime sync failed:", e);
  }
}

function EmptyChannels() {
  return (
    <div className="aia-empty">
      <div className="aia-empty-icon">📱</div>
      <h3>No WhatsApp channels yet</h3>
      <p>Add your first WhatsApp Business channel and map it to an AI agent.</p>
    </div>
  );
}

function ChannelCard({ channel, onEdit, onDelete }) {
  return (
    <motion.div
      className="aia-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      layout
    >
      <div className="aia-card-header">
        <div className="aia-avatar">WA</div>
        <div className="aia-card-meta">
          <h3 className="aia-card-name">{channel.display_phone_number || channel.phone_number_id}</h3>
          <span className="aia-card-model">WABA: {channel.whatsapp_business_account_id}</span>
        </div>
        <div className="aia-card-badge">
          <span className="aia-status-dot" />
          Active
        </div>
      </div>

      <p className="aia-card-desc">
        Linked Agent: <strong>{channel.ai_agent_name || channel.ai_agent_id || "Not linked"}</strong>
      </p>

      <div className="aia-resource-pills">
        <span className="aia-resource-pill">Phone ID: {channel.phone_number_id}</span>
        {channel.admin_phone && <span className="aia-resource-pill">Admin: {channel.admin_phone}</span>}
      </div>

      <div className="aia-card-actions">
        <button className="aia-btn aia-btn--secondary" onClick={() => onEdit(channel)}>
          Edit
        </button>
        <button className="aia-btn aia-btn--danger" onClick={() => onDelete(channel)}>
          Delete
        </button>
      </div>
    </motion.div>
  );
}

function ChannelModal({ open, onClose, onSaved, channel, agents }) {
  const [form, setForm] = useState({
    whatsapp_business_account_id: "",
    phone_number_id: "",
    display_phone_number: "",
    access_token: "",
    ai_agent_id: "",
    ai_agent_name: "",
    admin_phone: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (channel) {
      setForm({
        whatsapp_business_account_id: channel.whatsapp_business_account_id || "",
        phone_number_id: channel.phone_number_id || "",
        display_phone_number: channel.display_phone_number || "",
        access_token: channel.access_token || "",
        ai_agent_id: channel.ai_agent_id || "",
        ai_agent_name: channel.ai_agent_name || "",
        admin_phone: channel.admin_phone || "",
      });
    } else {
      setForm({
        whatsapp_business_account_id: "",
        phone_number_id: "",
        display_phone_number: "",
        access_token: "",
        ai_agent_id: "",
        ai_agent_name: "",
        admin_phone: "",
      });
    }
  }, [channel, open]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "ai_agent_id") {
      const selected = agents.find((a) => a.id === value);
      setForm((prev) => ({
        ...prev,
        ai_agent_id: value,
        ai_agent_name: selected?.name || "",
      }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.whatsapp_business_account_id || !form.phone_number_id || !form.access_token || !form.ai_agent_id) {
      toast.error("Please fill all required fields.");
      return;
    }

    setSaving(true);
    try {
      const isEdit = Boolean(channel?.id);
      const url = isEdit
        ? `${API_BASE}/whatsapp-channels/${channel.id}`
        : `${API_BASE}/whatsapp-channels`;
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaderObject() },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.detail || data.error || "Failed to save channel");

      await syncAgentToRuntime(form.ai_agent_id);

      toast.success(isEdit ? "Channel updated." : "Channel created.");
      onSaved(data.channel, isEdit);
      onClose();
    } catch (err) {
      toast.error(err.message || "Could not save channel");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-container aia-create-modal"
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="aia-modal-header">
              <h2>{channel ? "Edit WhatsApp Channel" : "Create WhatsApp Channel"}</h2>
              <button className="aia-modal-close" onClick={onClose}>✕</button>
            </div>

            <form className="aia-form" onSubmit={handleSubmit}>
              <div className="aia-form-group">
                <label>WhatsApp Business Account ID *</label>
                <input
                  name="whatsapp_business_account_id"
                  value={form.whatsapp_business_account_id}
                  onChange={handleChange}
                  required
                />
                <small className="aia-form-hint">
                  Meta → WhatsApp → API setup: use the <strong>WhatsApp Business Account ID</strong> (digits only).
                  Must match the <code>entry.id</code> in webhooks for this app.
                </small>
              </div>

              <div className="aia-form-group">
                <label>Phone Number ID *</label>
                <input name="phone_number_id" value={form.phone_number_id} onChange={handleChange} required />
                <small className="aia-form-hint">
                  Same screen: <strong>Phone number ID</strong> for the business number (not the display phone number).
                  If the bot is silent, this ID is usually wrong — the server matches on this + WABA.
                </small>
              </div>

              <div className="aia-form-group">
                <label>Display Phone Number</label>
                <input name="display_phone_number" value={form.display_phone_number} onChange={handleChange} />
              </div>

              <div className="aia-form-group">
                <label>Access Token *</label>
                <input type="password" name="access_token" value={form.access_token} onChange={handleChange} required />
              </div>

              <div className="aia-form-group">
                <label>Linked AI Agent *</label>
                <select name="ai_agent_id" value={form.ai_agent_id} onChange={handleChange} required>
                  <option value="">Select an agent</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="aia-form-group">
                <label>Admin Phone</label>
                <input name="admin_phone" value={form.admin_phone} onChange={handleChange} />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Saving..." : channel ? "Update Channel" : "Create Channel"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function WhatsAppChannelsPage() {
  const { user, isLoading } = useAuth();
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    if (!isLoading && !user) window.location.href = "/login/";
  }, [isLoading, user]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [channelsRes, agentsRes] = await Promise.all([
        fetch(`${API_BASE}/whatsapp-channels`, {
          credentials: "include",
          headers: { ...getAuthHeaderObject() },
        }),
        fetch(`${API_BASE}/agents`, {
          credentials: "include",
          headers: { ...getAuthHeaderObject() },
        }),
      ]);

      const channelsData = channelsRes.ok ? await channelsRes.json() : { channels: [] };
      const agentsData = agentsRes.ok ? await agentsRes.json() : [];
      setChannels(Array.isArray(channelsData?.channels) ? channelsData.channels : []);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
    } catch {
      toast.error("Failed to load WhatsApp channels.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaved = (savedChannel, isEdit) => {
    if (isEdit) {
      setChannels((prev) => prev.map((c) => (c.id === savedChannel.id ? savedChannel : c)));
      return;
    }
    setChannels((prev) => [savedChannel, ...prev]);
  };

  const handleDelete = async () => {
    if (!deleteTarget?.id) return;
    try {
      const res = await fetch(`${API_BASE}/whatsapp-channels/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { ...getAuthHeaderObject() },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.detail || data.error || "Delete failed");
      setChannels((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      toast.success("Channel deleted.");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.message || "Failed to delete channel");
    }
  };

  if (isLoading) {
    return (
      <div className="admin-page admin-page--status">
        <Navbar />
        <div className="admin-nav-spacer" />
        <div className="admin-status-card">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="admin-page">
      <Navbar />
      <div className="admin-nav-spacer" />

      <main className="admin-main">
        <section className="admin-hero" aria-label="WhatsApp channels dashboard">
          <p className="admin-kicker">WhatsApp Operations</p>
          <h1>WhatsApp Channels</h1>
          <p>Map each WhatsApp Business number to the right AI agent.</p>
        </section>

        <div className="aia-toolbar">
          <span className="aia-count">
            {channels.length} channel{channels.length !== 1 ? "s" : ""}
          </span>
          <button
            className="aia-create-btn"
            onClick={() => {
              setEditingChannel(null);
              setModalOpen(true);
            }}
          >
            + New Channel
          </button>
        </div>

        {loading ? (
          <div className="aia-loading">
            <div className="aia-spinner" />
            <p>Loading channels...</p>
          </div>
        ) : channels.length === 0 ? (
          <EmptyChannels />
        ) : (
          <div className="aia-grid">
            <AnimatePresence>
              {channels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  onEdit={(target) => {
                    setEditingChannel(target);
                    setModalOpen(true);
                  }}
                  onDelete={setDeleteTarget}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      <Footer />

      <ChannelModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        channel={editingChannel}
        agents={agents}
      />

      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              className="modal-container"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="modal-title">Delete Channel?</h3>
              <p className="modal-subtext">
                Are you sure you want to delete <strong>{deleteTarget?.display_phone_number || deleteTarget?.phone_number_id}</strong>?
              </p>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button className="btn" style={{ background: "#ef4444", color: "#fff" }} onClick={handleDelete}>
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ToastContainer position="top-right" autoClose={3000} theme="colored" />
    </div>
  );
}
