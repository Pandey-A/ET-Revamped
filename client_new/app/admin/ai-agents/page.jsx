'use client';

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ToastContainer, toast } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import "react-toastify/dist/ReactToastify.css";

const AI_AGENT_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || "http://localhost:8000";

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
function AgentCard({ agent, onChat, onResources, onDelete }) {
  return (
    <motion.div
      className="aia-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      layout
    >
      <div className="aia-card-header">
        <div className="aia-avatar">{agent.name?.[0]?.toUpperCase() || "A"}</div>
        <div className="aia-card-meta">
          <h3 className="aia-card-name">{agent.name}</h3>
          <span className="aia-card-model">{agent.model || "gpt-4o-mini"}</span>
        </div>
        <div className="aia-card-badge">
          <span className="aia-status-dot" />
          Active
        </div>
      </div>
      <p className="aia-card-desc">{agent.description || "No description provided."}</p>
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
        <button className="aia-btn aia-btn--primary" onClick={() => onChat(agent)}>
          💬 Chat
        </button>
        <button className="aia-btn aia-btn--secondary" onClick={() => onResources(agent)}>
          📚 Knowledge
        </button>
        <button className="aia-btn aia-btn--danger" onClick={() => onDelete(agent)}>
          🗑
        </button>
      </div>
    </motion.div>
  );
}

// ─── Create Agent Modal ───────────────────────────────────────────────────────
function CreateAgentModal({ open, onClose, onCreate }) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    model: "gpt-4o-mini",
    temperature: "0.7",
    escalation_channel: "none",
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Agent name is required.");
    setLoading(true);
    try {
      const agentId = generateId();
      const agentData = {
        id: agentId,
        name: form.name.trim(),
        description: form.description.trim(),
        model: form.model,
        temperature: parseFloat(form.temperature),
        escalation_channel: form.escalation_channel,
        collection_name: `${form.name.trim().replace(/\s+/g, "_")}_${agentId}`,
        resource_list: [],
        created_at: new Date().toISOString(),
      };

      const res = await fetch(`${AI_AGENT_API}/store/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agentData),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to create agent");

      toast.success(`Agent "${form.name}" created!`);
      onCreate(agentData);
      onClose();
      setForm({ name: "", description: "", model: "gpt-4o-mini", temperature: "0.7", escalation_channel: "none" });
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
              <div className="aia-form-group">
                <label>Agent Name *</label>
                <input
                  name="name"
                  placeholder="e.g. HR Assistant"
                  value={form.name}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="aia-form-group">
                <label>Description / System Prompt</label>
                <textarea
                  name="description"
                  rows={4}
                  placeholder="You are a helpful HR assistant who answers questions about company policies…"
                  value={form.description}
                  onChange={handleChange}
                />
              </div>
              <div className="aia-form-row">
                <div className="aia-form-group">
                  <label>LLM Model</label>
                  <select name="model" value={form.model} onChange={handleChange}>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                  </select>
                </div>
                <div className="aia-form-group">
                  <label>Temperature</label>
                  <input
                    name="temperature"
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={form.temperature}
                    onChange={handleChange}
                  />
                </div>
              </div>
              <div className="aia-form-group">
                <label>Escalation Channel</label>
                <select name="escalation_channel" value={form.escalation_channel} onChange={handleChange}>
                  <option value="none">None</option>
                  <option value="telegram">Telegram</option>
                </select>
              </div>
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AIAgentsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [agents, setAgents] = useState([]);
  const [fetchingAgents, setFetchingAgents] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // ── Auth guard
  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  // ── Load agents: show cached first, then refresh from backend
  const loadAgents = useCallback(async () => {
    // Show cached data immediately (no spinner for cached data)
    const stored = localStorage.getItem("ai_agents");
    if (stored) {
      try {
        const cached = JSON.parse(stored);
        if (Array.isArray(cached) && cached.length > 0) {
          setAgents(cached);
        }
      } catch {}
    }

    setFetchingAgents(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${AI_AGENT_API}/agents`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        setAgents(Array.isArray(data) ? data : []);
      }
    } catch {
      // Keep whatever we loaded from cache
    } finally {
      setFetchingAgents(false);
    }
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // ── Persist to localStorage whenever agents change (offline backup)
  useEffect(() => {
    if (agents.length > 0) localStorage.setItem("ai_agents", JSON.stringify(agents));
  }, [agents]);

  const handleCreated = (agent) => {
    setAgents((prev) => [agent, ...prev]);
  };

  const handleChat = (agent) => {
    router.push(`/admin/ai-agents/${agent.id}/chat`);
  };

  const handleResources = (agent) => {
   router.push(`/admin/ai-agents/${agent.id}/resources`);
  };

  const confirmDelete = (agent) => setDeleteTarget(agent);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const updated = agents.filter((a) => a.id !== deleteTarget.id);
    setAgents(updated);
    localStorage.setItem("ai_agents", JSON.stringify(updated));
    toast.success(`Agent "${deleteTarget.name}" removed.`);
    setDeleteTarget(null);
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
          <p>Build, configure and chat with RAG-powered agents backed by your documents.</p>
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
                  onChat={handleChat}
                  onResources={handleResources}
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
