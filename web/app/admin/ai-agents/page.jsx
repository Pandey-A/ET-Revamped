'use client';

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ToastContainer, toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import { getApiBaseUrl } from "@/lib/api";
import { getAuthHeaderObject } from "@/lib/authToken";
import { validateAgentCreateForm, formatApiValidationError } from "@/lib/validation/forms";
import "react-toastify/dist/ReactToastify.css";

async function apiFetch(path, opts = {}) {
  const url = `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const isJsonBody = typeof opts.body === "string";
  const baseHeaders = {
    ...getAuthHeaderObject(),
    ...(isJsonBody ? { "Content-Type": "application/json" } : {}),
  };
  return fetch(url, {
    credentials: "include",
    ...opts,
    headers: { ...baseHeaders, ...opts.headers },
  });
}

// ─── Utility ─────────────────────────────────────────────────────────────────
function generateId() {
  return `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Empty-state illustration ────────────────────────────────────────────────
function EmptyBots() {
  return (
    <div className="aia-empty">
      <div className="aia-empty-icon">🤖</div>
      <h3>No AI Agents yet</h3>
      <p>Create your first agent and give it a personality + knowledge base.</p>
    </div>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────
function AgentCard({ agent, onOpen, onEdit, onDelete }) {
  return (
    <motion.div
      className="aia-card aia-card--clickable"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      layout
      role="button"
      tabIndex={0}
      onClick={() => onOpen(agent)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(agent);
        }
      }}
    >
      <div className="aia-card-header">
        <div className="aia-avatar">{agent.name?.[0]?.toUpperCase() || "A"}</div>
        <div className="aia-card-meta">
          <h3 className="aia-card-name">{agent.name}</h3>
          {agent.company_name ? (
            <span className="aia-card-model">{agent.company_name}</span>
          ) : null}
        </div>
        <div className="aia-card-badge">
          <span className="aia-status-dot" />
          Active
        </div>
      </div>
      <p className="aia-card-desc">{agent.description || "No description provided."}</p>
      {agent.greeting_message && (
        <p className="aia-card-desc"><strong>Greeting:</strong> {agent.greeting_message}</p>
      )}
      {agent.resource_list?.length > 0 && (
        <div className="aia-resource-pills">
          {agent.resource_list.slice(0, 3).map((r, i) => (
            <span key={i} className="aia-resource-pill">
              📄 {r.split("/").pop()}
            </span>
          ))}
          {agent.resource_list.length > 3 && (
            <span className="aia-resource-pill aia-resource-pill--more">
              +{agent.resource_list.length - 3} more
            </span>
          )}
        </div>
      )}
      <div className="aia-card-actions">
        <button
          type="button"
          className="aia-btn aia-btn--secondary"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(agent);
          }}
        >
          Edit
        </button>
        <button
          type="button"
          className="aia-btn aia-btn--secondary"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(agent);
          }}
        >
          Open
        </button>
        <button
          type="button"
          className="aia-btn aia-btn--danger"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(agent);
          }}
        >
          🗑
        </button>
      </div>
    </motion.div>
  );
}

const EMPTY_AGENT_FORM = {
  name: "",
  company_name: "",
  description: "",
  greeting_message: "",
  widget_contact_email: "",
  whatsapp_contact_email: "",
  model: "gpt-4o-mini",
  temperature: "0.7",
};

function agentToForm(agent) {
  if (!agent) return { ...EMPTY_AGENT_FORM, resource_list: [] };
  return {
    name: agent.name || "",
    company_name: agent.company_name || "",
    description: agent.description || "",
    greeting_message: agent.greeting_message || "",
    widget_contact_email: agent.widget_contact_email || "",
    whatsapp_contact_email: agent.whatsapp_contact_email || "",
    model: agent.model || "gpt-4o-mini",
    temperature: String(agent.temperature ?? "0.7"),
    resource_list: Array.isArray(agent.resource_list) ? [...agent.resource_list] : [],
  };
}

function AgentFormFields({ form, onChange }) {
  return (
    <>
      <div className="aia-form-group">
        <label>Agent Name *</label>
        <input
          name="name"
          placeholder="e.g. HR Assistant"
          value={form.name}
          onChange={onChange}
          required
        />
      </div>
      <div className="aia-form-group">
        <label>Company Name (shown to users)</label>
        <input
          name="company_name"
          placeholder="e.g. Chattiq"
          value={form.company_name}
          onChange={onChange}
        />
        <p className="aia-form-hint">Used in chat replies when the bot cannot answer from the knowledge base.</p>
      </div>
      <div className="aia-form-group">
        <label>Widget contact email</label>
        <input
          name="widget_contact_email"
          type="email"
          placeholder="e.g. info@chatiq.co.in"
          value={form.widget_contact_email}
          onChange={onChange}
        />
        <p className="aia-form-hint">Optional. Enables transfer + email fallback on the website widget only.</p>
      </div>
      <div className="aia-form-group">
        <label>WhatsApp contact email</label>
        <input
          name="whatsapp_contact_email"
          type="email"
          placeholder="e.g. support@yourcompany.com"
          value={form.whatsapp_contact_email}
          onChange={onChange}
        />
        <p className="aia-form-hint">Optional. Separate escalation message for WhatsApp (can differ from widget).</p>
      </div>
      <div className="aia-form-group">
        <label>Instructions</label>
        <textarea
          name="description"
          rows={4}
          placeholder="Describe how this agent should help customers — tone, topics, and what to do when unsure…"
          value={form.description}
          onChange={onChange}
        />
      </div>
      <div className="aia-form-group">
        <label>Greeting Message (for channel replies)</label>
        <input
          name="greeting_message"
          placeholder="e.g. Hello from ServiceNow Assistant."
          value={form.greeting_message}
          onChange={onChange}
        />
      </div>
    </>
  );
}

// ─── Create Agent Modal ───────────────────────────────────────────────────────
function CreateAgentModal({ open, onClose, onCreate }) {
  const [form, setForm] = useState({ ...EMPTY_AGENT_FORM });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validation = validateAgentCreateForm(form);
    if (!validation.ok) {
      toast.error(validation.errors[0]);
      return;
    }
    setLoading(true);
    try {
      const agentId = generateId();
      const agentData = {
        id: agentId,
        name: form.name.trim(),
        company_name: form.company_name.trim(),
        description: form.description.trim(),
        greeting_message: form.greeting_message.trim(),
        widget_contact_email: form.widget_contact_email.trim(),
        whatsapp_contact_email: form.whatsapp_contact_email.trim(),
        model: form.model,
        temperature: parseFloat(form.temperature),
        collection_name: `${form.name.trim().replace(/\s+/g, "_")}_${agentId}`,
        resource_list: [],
        created_at: new Date().toISOString(),
        /** When false, POST /api/widget/chat rejects this agent id (public embed). Default: allow. */
        public_embed: true,
      };

      const res = await apiFetch("/agents", {
        method: "POST",
        body: JSON.stringify(agentData),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) throw new Error(formatApiValidationError(data) || data.message || data.detail || "Failed to create agent");

      toast.success(`Agent "${form.name}" created!`);
      onCreate(data.agent || agentData);
      onClose();
      setForm({ ...EMPTY_AGENT_FORM });
    } catch (err) {
      toast.error(err.message || "Could not create agent");
    } finally {
      setLoading(false);
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
              <h2>Create New Agent</h2>
              <button className="aia-modal-close" onClick={onClose}>✕</button>
            </div>
            <form className="aia-form" onSubmit={handleSubmit}>
              <AgentFormFields form={form} onChange={handleChange} />
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn primary" disabled={loading}>
                  {loading ? "Creating…" : "Create Agent"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function resourceLabel(resource) {
  if (!resource) return "Resource";
  if (resource.startsWith("http://") || resource.startsWith("https://")) {
    try {
      return new URL(resource).hostname;
    } catch {
      return resource;
    }
  }
  return resource.split("/").pop() || resource;
}

// ─── Edit Agent Modal ─────────────────────────────────────────────────────────
function EditAgentModal({ open, agent, onClose, onSaved }) {
  const router = useRouter();
  const [form, setForm] = useState(agentToForm(agent));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && agent) setForm(agentToForm(agent));
  }, [open, agent]);

  const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const removeResource = (resource) => {
    setForm((p) => ({
      ...p,
      resource_list: (p.resource_list || []).filter((r) => r !== resource),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!agent?.id) return;
    const validation = validateAgentCreateForm(form);
    if (!validation.ok) {
      toast.error(validation.errors[0]);
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        company_name: form.company_name.trim(),
        description: form.description.trim(),
        greeting_message: form.greeting_message.trim(),
        widget_contact_email: form.widget_contact_email.trim(),
        whatsapp_contact_email: form.whatsapp_contact_email.trim(),
        resource_list: form.resource_list || [],
      };
      const res = await apiFetch(`/agents/${encodeURIComponent(agent.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(formatApiValidationError(data) || data.message || "Update failed");
      }
      toast.success(`Agent "${form.name.trim()}" updated.`);
      onSaved(data.agent || { ...agent, ...payload });
      onClose();
    } catch (err) {
      toast.error(err.message || "Could not update agent");
    } finally {
      setLoading(false);
    }
  };

  if (!open || !agent) return null;

  const resources = form.resource_list || [];

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
            className="modal-container aia-create-modal aia-edit-modal"
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="aia-modal-header">
              <h2>Edit Agent</h2>
              <button type="button" className="aia-modal-close" onClick={onClose}>✕</button>
            </div>
            <form className="aia-form" onSubmit={handleSubmit}>
              <AgentFormFields form={form} onChange={handleChange} />

              <div className="aia-form-group">
                <div className="aia-edit-kb-header">
                  <label>Knowledge base</label>
                  <button
                    type="button"
                    className="aia-btn aia-btn--ghost aia-btn--sm"
                    onClick={() => {
                      onClose();
                      router.push(`/admin/ai-agents/${agent.id}/resources`);
                    }}
                  >
                    + Add documents
                  </button>
                </div>
                {resources.length === 0 ? (
                  <p className="aia-form-hint">No documents yet. Add PDFs or URLs from the knowledge base page.</p>
                ) : (
                  <ul className="aia-edit-kb-list">
                    {resources.map((resource) => (
                      <li key={resource} className="aia-edit-kb-item">
                        <span className="aia-edit-kb-item-label" title={resource}>
                          {resourceLabel(resource)}
                        </span>
                        <button
                          type="button"
                          className="aia-btn aia-btn--danger aia-btn--sm"
                          onClick={() => removeResource(resource)}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="aia-form-hint">
                  Removing a document updates the agent immediately on save. Re-indexing may take a moment.
                </p>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn primary" disabled={loading}>
                  {loading ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AIAgentsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [agents, setAgents] = useState([]);
  const [fetchingAgents, setFetchingAgents] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // ── Auth guard
  useEffect(() => {
    if (!isLoading && !user) window.location.href = '/login/';
  }, [isLoading, user]);

  // ── Load agents: show cached first, then refresh from backend
  const loadAgents = useCallback(async () => {
    setFetchingAgents(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      const res = await apiFetch("/agents", { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        setAgents(Array.isArray(data) ? data : []);
      } else if (res.status === 401) {
        setAgents([]);
      }
    } catch {
      // network / abort — keep current list
    } finally {
      setFetchingAgents(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoading && user?.id) loadAgents();
  }, [isLoading, user?.id, loadAgents]);

  const handleCreated = (agent) => {
    setAgents((prev) => [agent, ...prev.filter((a) => a.id !== agent.id)]);
  };

  const handleOpenAgent = (agent) => {
    router.push(`/admin/ai-agents/${agent.id}`);
  };

  const handleUpdated = (agent) => {
    setAgents((prev) => prev.map((a) => (a.id === agent.id ? agent : a)));
  };

  const confirmDelete = (agent) => setDeleteTarget(agent);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await apiFetch(`/agents/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Delete failed");
      setAgents((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      toast.success(`Agent "${deleteTarget.name}" removed.`);
    } catch (e) {
      toast.error(e.message || "Could not delete agent");
    } finally {
      setDeleteTarget(null);
    }
  };

  if (isLoading) {
    return (
      <div className="admin-page admin-page--status">
        <Navbar />
        <div className="admin-nav-spacer" />
        <div className="admin-status-card">Loading…</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="admin-page">
      <Navbar />
      <div className="admin-nav-spacer" />

      <main className="admin-main">
        {/* ── Header */}
        <section className="admin-hero" aria-label="AI Agents dashboard">
          <p className="admin-kicker">AI Agent Studio</p>
          <h1>Your AI Agents</h1>
          <p>Click an agent to open Chat, Knowledge base, and Widget generator in one place.</p>
        </section>

        {/* ── Toolbar */}
        <div className="aia-toolbar">
          <span className="aia-count">
            {agents.length} agent{agents.length !== 1 ? "s" : ""}
          </span>
          <button className="aia-create-btn" onClick={() => setCreateOpen(true)}>
            + New Agent
          </button>
        </div>

        {/* ── Grid */}
        {fetchingAgents ? (
          <div className="aia-loading">
            <div className="aia-spinner" />
            <p>Loading agents…</p>
          </div>
        ) : agents.length === 0 ? (
          <EmptyBots />
        ) : (
          <div className="aia-grid">
            <AnimatePresence>
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onOpen={handleOpenAgent}
                  onEdit={setEditTarget}
                  onDelete={confirmDelete}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      <Footer />

      {/* ── Create Modal */}
      <CreateAgentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreated}
      />

      <EditAgentModal
        open={Boolean(editTarget)}
        agent={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={handleUpdated}
      />

      {/* ── Delete Confirm Modal */}
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
              <h3 className="modal-title">Delete Agent?</h3>
              <p className="modal-subtext">
                Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
              </p>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button
                  className="btn"
                  style={{ background: "#ef4444", color: "#fff" }}
                  onClick={handleDelete}
                >
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
