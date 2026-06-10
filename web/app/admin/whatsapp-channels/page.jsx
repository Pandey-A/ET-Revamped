'use client';

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ToastContainer, toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import "react-toastify/dist/ReactToastify.css";
import { getApiBaseUrl, fetchMyAgents } from "@/lib/api";
import { getAuthHeaderObject } from "@/lib/authToken";
import { formatApiValidationError, validateWhatsAppChannelForm } from "@/lib/validation/forms";

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

const DEFAULT_BROADCAST_TEMPLATE =
  "Hello {User},\n\nWe have an update for you.\n\nReply here if you have any questions.";

function previewBroadcastMessage(template, sampleName = "Rahul") {
  const name = (sampleName || "").trim() || "there";
  return (template || "").replace(/\{user\}|\{name\}/gi, name);
}

function formatBroadcastError(data) {
  if (!data) return "Broadcast failed";
  if (typeof data.image_resolve_error === "string" && data.image_resolve_error) {
    return data.image_resolve_error;
  }
  if (typeof data.message === "string" && data.message) return data.message;
  if (typeof data.error === "string" && data.error) return data.error;
  if (typeof data.detail === "string") return data.detail;
  const first = data.errors?.[0]?.error;
  if (typeof first === "string") return first;
  if (first?.error?.message) return first.error.message;
  if (first?.message) return first.message;
  return "Broadcast failed — check API server and WhatsApp token.";
}

function BroadcastModal({ open, onClose, channel }) {
  const [message, setMessage] = useState(DEFAULT_BROADCAST_TEMPLATE);
  const [phones, setPhones] = useState("");
  const [audience, setAudience] = useState("manual");
  const [imageUrl, setImageUrl] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [previewName, setPreviewName] = useState("Rahul");
  const [sending, setSending] = useState(false);
  const [recipientCount, setRecipientCount] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setMessage(DEFAULT_BROADCAST_TEMPLATE);
      setPhones("");
      setAudience("manual");
      setImageUrl("");
      setImageFile(null);
      setImagePreview("");
      setPreviewName("Rahul");
      setRecipientCount(null);
    }
  }, [open, channel?.id]);

  const refreshRecipientPreview = useCallback(async () => {
    if (!channel?.id) return;
    if (audience === "manual" && !phones.trim()) {
      setRecipientCount(0);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/whatsapp-channels/${channel.id}/broadcast/preview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaderObject() },
        body: JSON.stringify({ audience, phones: phones.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(formatBroadcastError(data));
      setRecipientCount(data.recipients ?? 0);
    } catch {
      setRecipientCount(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [channel?.id, audience, phones]);

  useEffect(() => {
    if (!open || !channel?.id) return;
    const t = setTimeout(refreshRecipientPreview, 400);
    return () => clearTimeout(t);
  }, [open, channel?.id, audience, phones, refreshRecipientPreview]);

  const insertPlaceholder = () => {
    setMessage((prev) => (prev.includes("{User}") ? prev : `${prev}{User}`));
  };

  const uploadBroadcastImage = (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type || "")) {
      toast.error("Use a JPG, PNG, WebP, or GIF image (max 5MB).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB.");
      return;
    }
    setImageFile(file);
    setImageUrl("");
    setImagePreview(URL.createObjectURL(file));
    toast.success("Image attached — it will upload when you send.");
  };

  const sendBroadcast = async () => {
    if (!channel?.id) return;
    const text = message.trim();
    if (!text) {
      toast.error("Enter a message to send.");
      return;
    }
    if (audience === "manual" && !phones.trim()) {
      toast.error("Add at least one phone number (one per line) or change audience.");
      return;
    }

    setSending(true);
    try {
      const form = new FormData();
      form.append("message", text);
      form.append("audience", audience);
      form.append("phones", phones.trim());
      if (imageFile) {
        form.append("image", imageFile, imageFile.name || "broadcast.png");
      } else if (imageUrl) {
        form.append("image_url", imageUrl);
      }

      const res = await fetch(`${getApiBaseUrl()}/whatsapp-channels/${channel.id}/broadcast`, {
        method: "POST",
        credentials: "include",
        headers: { ...getAuthHeaderObject() },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(formatBroadcastError(data));

      const sent = data.sent ?? 0;
      const total = data.recipients ?? 0;
      const imagesSent = data.images_sent ?? (data.with_image ? sent : 0);

      if (total === 0) {
        toast.error(
          data.error ||
            "No recipients found. Add phone numbers (manual) or use Saved leads / All contacts."
        );
        return;
      }
      if (sent === 0 || data.success === false) {
        toast.error(formatBroadcastError(data));
        return;
      }

      if (data.image_requested && imagesSent === 0) {
        toast.error(formatBroadcastError(data));
        return;
      }
      if (data.with_image) {
        toast.success(`Broadcast with image sent to ${sent} of ${total} contact(s).`);
      } else {
        toast.success(`Broadcast sent to ${sent} of ${total} contact(s).`);
      }
      if (data.failed > 0) {
        toast.warn(`${data.failed} message(s) failed — see server logs for details.`);
      }
      onClose();
    } catch (err) {
      toast.error(err.message || "Could not send broadcast");
    } finally {
      setSending(false);
    }
  };

  if (!open || !channel) return null;

  return (
    <AnimatePresence>
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
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="modal-title">Send broadcast</h3>
          <p className="modal-subtext">
            {channel.display_phone_number || channel.phone_number_id} — messages go only to numbers
            you list or saved leads. WhatsApp may block messages outside the 24-hour window unless you use an approved template.
          </p>

          <div className="aia-form-group">
            <label>Message template</label>
            <p className="modal-subtext" style={{ marginTop: 0, marginBottom: 8 }}>
              Use <strong>{"{User}"}</strong> or <strong>{"{Name}"}</strong> — replaced with each
              contact&apos;s name from leads, or the name you add next to their number.
            </p>
            <textarea
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={"Hello {User},\n\nYour message here…"}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" className="aia-btn aia-btn--secondary" onClick={insertPlaceholder}>
                Insert {"{User}"}
              </button>
              <button
                type="button"
                className="aia-btn aia-btn--secondary"
                onClick={() => setMessage(DEFAULT_BROADCAST_TEMPLATE)}
              >
                Reset template
              </button>
            </div>
          </div>

          <div className="aia-form-group">
            <label>Preview (sample name)</label>
            <input
              type="text"
              value={previewName}
              onChange={(e) => setPreviewName(e.target.value)}
              placeholder="Rahul"
              style={{ width: "100%", marginBottom: 8 }}
            />
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
                whiteSpace: "pre-wrap",
                fontSize: 14,
              }}
            >
              {previewBroadcastMessage(message, previewName) || "—"}
            </div>
          </div>

          <div className="aia-form-group">
            <label>Image (optional)</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={sending}
              onChange={(e) => uploadBroadcastImage(e.target.files?.[0])}
            />
            {(imageFile || imageUrl) && (
              <p className="modal-subtext" style={{ marginTop: 8 }}>
                {imageFile ? `Attached: ${imageFile.name}` : `Attached: ${imageUrl}`}
                {imagePreview && (
                  <img
                    src={imagePreview}
                    alt="Broadcast preview"
                    style={{ display: "block", maxWidth: 200, marginTop: 8, borderRadius: 8 }}
                  />
                )}
                {" "}
                <button
                  type="button"
                  className="aia-btn aia-btn--secondary"
                  onClick={() => {
                    setImageFile(null);
                    setImageUrl("");
                    setImagePreview("");
                  }}
                >
                  Remove
                </button>
              </p>
            )}
          </div>

          <div className="aia-form-group">
            <label>Send to</label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              style={{ width: "100%", marginBottom: 8 }}
            >
              <option value="manual">Manual phone numbers</option>
              <option value="leads">Saved leads (this agent)</option>
              <option value="all">All saved contacts (leads + past chatters)</option>
            </select>
            <p className="modal-subtext" style={{ marginTop: 4 }}>
              {previewLoading
                ? "Counting recipients…"
                : recipientCount != null
                  ? `${recipientCount} recipient(s) will receive this broadcast`
                  : "Recipients: enter numbers or choose an audience"}
            </p>
            <button
              type="button"
              className="aia-btn aia-btn--secondary"
              style={{ marginTop: 6 }}
              onClick={refreshRecipientPreview}
              disabled={previewLoading}
            >
              Refresh count
            </button>
          </div>

          {audience === "manual" && (
            <div className="aia-form-group">
              <label>Phone numbers (one per line)</label>
              <p className="modal-subtext" style={{ marginTop: 0, marginBottom: 6 }}>
                Format: <code>919876543210</code> or <code>919876543210, Rahul</code> for a custom name.
              </p>
              <textarea
                rows={4}
                value={phones}
                onChange={(e) => setPhones(e.target.value)}
                placeholder={"919876543210, Rahul\n918765432109, Priya"}
                style={{ width: "100%" }}
              />
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={sendBroadcast}
              disabled={sending}
            >
              {sending ? "Sending…" : "Send broadcast"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ChannelCard({ channel, onEdit, onDelete, onBroadcast }) {
  if (!channel?.id) return null;

  return (
    <div className="aia-card">
      <div className="aia-card-header">
        <div className="aia-avatar">WA</div>
        <div className="aia-card-meta">
          <h3 className="aia-card-name">{channel.display_phone_number || channel.phone_number_id}</h3>
          {channel.display_phone_number && channel.phone_number_id ? (
            <span className="aia-card-model">WhatsApp Business</span>
          ) : null}
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
        <button className="aia-btn aia-btn--secondary" onClick={() => onBroadcast(channel)}>
          Broadcast
        </button>
        <button className="aia-btn aia-btn--secondary" onClick={() => onEdit(channel)}>
          Edit
        </button>
        <button className="aia-btn aia-btn--danger" onClick={() => onDelete(channel)}>
          Delete
        </button>
      </div>
    </div>
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
        access_token: channel.access_token_set ? "••••••••" : "",
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
    const validation = validateWhatsAppChannelForm(form, { isEdit: Boolean(channel?.id) });
    if (!validation.ok) {
      toast.error(validation.errors[0]);
      return;
    }

    setSaving(true);
    try {
      const isEdit = Boolean(channel?.id);
      const payload = { ...validation.normalized };
      if (isEdit && payload.access_token === "••••••••") {
        delete payload.access_token;
      }
      const url = isEdit
        ? `${API_BASE}/whatsapp-channels/${channel.id}`
        : `${API_BASE}/whatsapp-channels`;
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaderObject() },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(formatApiValidationError(data) || data.message || data.detail || data.error || "Failed to save channel");

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
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-container aia-create-modal"
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
                  From Meta Business settings: the <strong>Phone number ID</strong> for this WhatsApp number.
                  If the bot does not reply, this value is usually incorrect.
                </small>
              </div>

              <div className="aia-form-group">
                <label>Display Phone Number</label>
                <input name="display_phone_number" value={form.display_phone_number} onChange={handleChange} />
              </div>

              <div className="aia-form-group">
                <label>Access Token *</label>
                <input type="password" name="access_token" value={form.access_token} onChange={handleChange} required={!channel?.id} />
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
                <small className="aia-form-hint">
                  WhatsApp replies are generated by this agent using its knowledge base and LLM — no separate greeting or menu setup needed.
                </small>
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
      </div>
    </div>
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
  const [broadcastChannel, setBroadcastChannel] = useState(null);

  useEffect(() => {
    if (!isLoading && !user) window.location.href = "/login/";
  }, [isLoading, user]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [channelsRes, agentsList] = await Promise.all([
        fetch(`${API_BASE}/whatsapp-channels`, {
          credentials: "include",
          headers: { ...getAuthHeaderObject() },
        }),
        fetchMyAgents(),
      ]);

      if (channelsRes.ok) {
        const channelsData = await channelsRes.json();
        const list = Array.isArray(channelsData?.channels) ? channelsData.channels : [];
        setChannels(list.filter((c) => c && c.id));
      } else {
        setChannels([]);
        toast.error("Failed to load WhatsApp channels.");
      }

      setAgents(Array.isArray(agentsList) ? agentsList : []);
    } catch {
      setChannels([]);
      setAgents([]);
      toast.error("Failed to load WhatsApp channels.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaved = (savedChannel, isEdit) => {
    if (!savedChannel?.id) {
      loadData();
      return;
    }
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
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                onEdit={(target) => {
                  setEditingChannel(target);
                  setModalOpen(true);
                }}
                onDelete={setDeleteTarget}
                onBroadcast={setBroadcastChannel}
              />
            ))}
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

      <BroadcastModal
        open={Boolean(broadcastChannel)}
        onClose={() => setBroadcastChannel(null)}
        channel={broadcastChannel}
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
