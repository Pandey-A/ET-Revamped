'use client';
import { useParams } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { toast, ToastContainer } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import { fetchMyAgents, getApiBaseUrl } from "@/lib/api";
import { getAuthHeaderObject } from "@/lib/authToken";
import { isAgentChatReady } from "@/lib/agentIndexing";
import { useAgentIndexingPoll } from "@/hooks/useAgentIndexingPoll";
import "react-toastify/dist/ReactToastify.css";

const AI_AGENT_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || "http://localhost:8000";

function isPdfFile(file) {
  if (!file) return false;
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".pdf")) return true;
  const t = String(file.type || "").toLowerCase();
  return t === "application/pdf" || t === "application/x-pdf";
}

function resolveCollectionName(agent) {
  if (!agent) return "";
  if (agent.collection_name && String(agent.collection_name).trim()) {
    return String(agent.collection_name).trim();
  }
  const safe = String(agent.name || "agent")
    .trim()
    .replace(/\s+/g, "_");
  return `${safe}_${agent.id}`;
}

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
      throw new Error(body.message || `Sync failed (${res.status})`);
    }
  } catch (e) {
    console.warn("Agent runtime sync:", e.message || e);
    throw e;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getAgentFromStorage(id) {
  try {
    const stored = localStorage.getItem("ai_agents");
    if (!stored) return null;
    const agents = JSON.parse(stored);
    return agents.find((a) => a.id === id) || null;
  } catch {
    return null;
  }
}

function updateAgentInStorage(updatedAgent) {
  try {
    const stored = localStorage.getItem("ai_agents");
    const agents = stored ? JSON.parse(stored) : [];
    const idx = agents.findIndex((a) => a.id === updatedAgent.id);
    if (idx > -1) {
      agents[idx] = updatedAgent;
      localStorage.setItem("ai_agents", JSON.stringify(agents));
    }
  } catch {}
}

// ─── Resource Row ─────────────────────────────────────────────────────────────
function ResourceRow({ resource, index, indexingStatus }) {
  const isPdf = resource.toLowerCase().endsWith(".pdf") || resource.startsWith("temp_files/");
  const isUrl = resource.startsWith("http://") || resource.startsWith("https://");
  const label = resource.split("/").pop();
  const isProcessing = indexingStatus === "processing";

  return (
    <motion.div
      className="aia-resource-row"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <span className="aia-resource-row-icon">{isPdf ? "📄" : isUrl ? "🌐" : "📎"}</span>
      <div className="aia-resource-row-info">
        <span className="aia-resource-row-name">{label}</span>
        <span className="aia-resource-row-type">{isPdf ? "PDF Document" : isUrl ? "Web URL" : "Resource"}</span>
      </div>
      {isProcessing ? (
        <span className="aia-resource-row-badge aia-resource-row-badge--processing">
          <span className="aia-spinner aia-spinner--xs" /> Indexing…
        </span>
      ) : (
        <span className="aia-resource-row-badge">✓ Indexed</span>
      )}
    </motion.div>
  );
}

// ─── Dropzone ────────────────────────────────────────────────────────────────
function Dropzone({ onDrop, uploading, uploadStage }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(isPdfFile);
    if (files.length === 0) return toast.error("Only PDF files are accepted.");
    onDrop(files);
  };

  const handleFile = (e) => {
    const files = Array.from(e.target.files).filter(isPdfFile);
    if (files.length === 0) return toast.error("Please select a PDF file (.pdf).");
    onDrop(files);
    e.target.value = "";
  };

  return (
    <div
      className={`aia-dropzone ${dragging ? "aia-dropzone--active" : ""} ${uploading ? "aia-dropzone--uploading" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !uploading && inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept="application/pdf" multiple hidden onChange={handleFile} />
      {uploading ? (
        <div className="aia-dropzone-uploading">
          <div className="aia-upload-progress">
            <div className="aia-spinner" />
            <p className="aia-upload-stage">{uploadStage || "Uploading…"}</p>
            <div className="aia-upload-steps">
              <span className={`aia-upload-step ${uploadStage?.includes("Uploading") ? "aia-upload-step--active" : "aia-upload-step--done"}`}>
                📤 Upload
              </span>
              <span className="aia-upload-step-arrow">→</span>
              <span className={`aia-upload-step ${uploadStage?.includes("Indexing") ? "aia-upload-step--active" : ""}`}>
                🔍 Index
              </span>
              <span className="aia-upload-step-arrow">→</span>
              <span className="aia-upload-step">✅ Done</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="aia-dropzone-icon">📄</div>
          <p className="aia-dropzone-text">
            {dragging ? "Drop PDF here" : "Drag & drop PDF here or click to browse"}
          </p>
          <span className="aia-dropzone-sub">Only .pdf files are supported</span>
        </>
      )}
    </div>
  );
}

// ─── Floating Chat Button ─────────────────────────────────────────────────────
function FloatingChatButton({ agentName, onClick }) {
  return (
    <motion.button
      className="aia-fab"
      onClick={onClick}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.3 }}
      title={`Chat with ${agentName}`}
    >
      <span className="aia-fab-icon">💬</span>
      <span className="aia-fab-label">Chat with {agentName}</span>
    </motion.button>
  );
}

// ─── Main Client Page ─────────────────────────────────────────────────────────
export default function ClientPage() {
  const { id } = useParams();
  const router = useRouter();

  const [agent, setAgent] = useState(null);
  const [urlInput, setUrlInput] = useState("");
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadStage, setUploadStage] = useState("");
  const [indexingUrl, setIndexingUrl] = useState(false);

  const onIndexingSuccess = useCallback((resourceKey) => {
    toast.success(`"${resourceKey.split("/").pop()}" indexed successfully!`);
  }, []);

  const onIndexingError = useCallback((resourceKey, data) => {
    toast.error(`Indexing failed: ${data?.message || resourceKey}`);
  }, []);

  const { pendingTasks, pendingCount, registerTask } = useAgentIndexingPoll(id, {
    onTaskSuccess: onIndexingSuccess,
    onTaskError: onIndexingError,
  });

  // Load agent
  useEffect(() => {
    if (!id) return;

    // Try localStorage first for instant load
    const found = getAgentFromStorage(id);
    if (found) {
      setAgent(found);
    }

    // Also try fetching from backend (in case localStorage is stale)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetchMyAgents({ signal: controller.signal })
      .then((data) => {
        if (Array.isArray(data)) {
          const backendAgent = data.find((a) => a.id === id);
          if (backendAgent) {
            setAgent(backendAgent);
          }
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));

    if (!found) {
      setTimeout(() => {
        setAgent((current) => {
          if (!current) {
            toast.error("Agent not found.");
            router.replace(`/admin/ai-agents/${id}`);
          }
          return current;
        });
      }, 3000);
    }
  }, [id, router]);

  // ── Upload PDF
  const handlePdfDrop = useCallback(async (files) => {
    if (!agent) return;
    const collectionName = resolveCollectionName(agent);
    if (!collectionName || !agent.id) {
      toast.error("Agent is missing collection name. Open the agent and save again, or sync runtime.");
      return;
    }

    setUploadingPdf(true);
    setUploadStage("📤 Syncing agent to AI runtime…");
    try {
      await syncAgentToRuntime(agent.id);
    } catch (e) {
      toast.warn(`Runtime sync: ${e.message}. Trying upload anyway…`);
    }

    setUploadStage("📤 Uploading file…");
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("collection_name", collectionName);
        formData.append("agent_id", agent.id);

        setUploadStage("📤 Uploading file…");
        const res = await fetch(`${AI_AGENT_API}/index/pdf`, {
          method: "POST",
          body: formData,
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          throw new Error(
            res.status === 0
              ? `Cannot reach AI server at ${AI_AGENT_API}. Is FastAPI running on port 8000?`
              : "Upload failed (invalid response from server)."
          );
        }
        if (!res.ok) {
          const msg = data.error || data.detail || data.message || `Upload failed (${res.status})`;
          throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
        }

        const resourceKey = `temp_files/${file.name}`;

        // Update agent in state immediately
        setAgent((prev) => {
          const updated = {
            ...prev,
            resource_list: [...(prev.resource_list || []), resourceKey],
          };
          updateAgentInStorage(updated);
          return updated;
        });

        // Track indexing task
        if (data.task_id) {
          registerTask(resourceKey, data.task_id);
          setUploadStage("🔍 Indexing in background…");
          toast.info(`"${file.name}" uploaded! Indexing in background…`);
        } else {
          toast.success(`"${file.name}" indexed successfully!`);
        }
      }
    } catch (err) {
      toast.error(err.message || "PDF upload failed. Is the agent backend running?");
    } finally {
      setUploadingPdf(false);
      setUploadStage("");
    }
  }, [agent, registerTask]);

  // ── Index URL
  const handleIndexUrl = async () => {
    if (!urlInput.trim()) return toast.error("Please enter a URL.");
    if (!/^https?:\/\/.+/.test(urlInput.trim())) return toast.error("Enter a valid http/https URL.");
    if (!agent) return;
    setIndexingUrl(true);
    try {
      const res = await fetch(`${AI_AGENT_API}/index/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urlInput.trim(),
          collection_name: agent.collection_name,
          agent_id: agent.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "URL indexing failed");

      const resourceKey = urlInput.trim();

      setAgent((prev) => {
        const updated = {
          ...prev,
          resource_list: [...(prev.resource_list || []), resourceKey],
        };
        updateAgentInStorage(updated);
        return updated;
      });

      // Track indexing task
      if (data.task_id) {
        registerTask(resourceKey, data.task_id);
        toast.info("URL accepted! Indexing in background…");
      } else {
        toast.success("URL indexed into knowledge base!");
      }
      setUrlInput("");
    } catch (err) {
      toast.error(err.message || "URL indexing failed. Is the agent backend running?");
    } finally {
      setIndexingUrl(false);
    }
  };

  if (!agent) {
    return (
      <div className="admin-page admin-page--status">
        <Navbar />
        <div className="admin-nav-spacer" />
        <div className="admin-status-card">Loading agent…</div>
      </div>
    );
  }

  const hasResources = agent.resource_list?.length > 0;
  const isIndexingActive = uploadingPdf || indexingUrl || pendingCount > 0;
  const canOpenChat = isAgentChatReady(agent, { uploading: uploadingPdf || indexingUrl });
  const activeIndexingCount = pendingCount + (uploadingPdf || indexingUrl ? 1 : 0);

  return (
    <div className="admin-page">
      <Navbar />
      <div className="admin-nav-spacer" />

      <main className="admin-main">
        {/* ── Breadcrumb + Header */}
        <div className="aia-breadcrumb">
          <button onClick={() => router.push(`/admin/ai-agents/${id}`)}>← Back to agent</button>
        </div>

        <section className="admin-hero">
          <p className="admin-kicker">Knowledge Base</p>
          <h1>
            <span className="aia-agent-initial">{agent.name[0].toUpperCase()}</span>
            {agent.name}
          </h1>
          <p>{agent.description || "No description set."}</p>
        </section>

        {/* ── Indexing Status Banner */}
        <AnimatePresence>
          {activeIndexingCount > 0 && (
            <motion.div
              className="aia-indexing-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="aia-spinner aia-spinner--sm" />
              <span>
                {activeIndexingCount} resource{activeIndexingCount > 1 ? "s" : ""} indexing in background…
                You can continue using the app.
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="aia-resources-layout">
          {/* ── Upload Column */}
          <div className="aia-resources-col">
            {/* PDF Upload */}
            <div className="aia-resources-section glass-card">
              <h3>📄 Upload PDF Documents</h3>
              <p className="aia-resources-sub">
                Upload PDFs so your agent can answer questions from them.
              </p>
              <Dropzone onDrop={handlePdfDrop} uploading={uploadingPdf} uploadStage={uploadStage} />
            </div>

            {/* URL Indexing */}
            <div className="aia-resources-section glass-card">
              <h3>🌐 Index a Web Page</h3>
              <p className="aia-resources-sub">
                Add a public web page to your agent&apos;s knowledge base.
              </p>
              <div className="aia-url-row">
                <input
                  type="url"
                  placeholder="https://docs.example.com/page"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleIndexUrl()}
                  disabled={indexingUrl}
                />
                <button
                  className="aia-btn aia-btn--primary"
                  onClick={handleIndexUrl}
                  disabled={indexingUrl}
                >
                  {indexingUrl ? <span className="aia-spinner aia-spinner--sm" /> : "Index"}
                </button>
              </div>
            </div>
          </div>

          {/* ── Resources List */}
          <div className="aia-resources-col">
            <div className="aia-resources-section glass-card aia-resources-list-card">
              <div className="aia-resources-list-header">
                <h3>📚 Indexed Resources</h3>
                <span className="aia-resource-count-badge">{agent.resource_list?.length || 0}</span>
              </div>
              {!agent.resource_list?.length ? (
                <div className="aia-resources-empty">
                  <span>🗂</span>
                  <p>No resources indexed yet. Upload a PDF or add a URL.</p>
                </div>
              ) : (
                <div className="aia-resources-list">
                  <AnimatePresence>
                    {agent.resource_list.map((r, i) => (
                      <ResourceRow
                        key={r}
                        resource={r}
                        index={i}
                        indexingStatus={pendingTasks[r] ? "processing" : "done"}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {canOpenChat ? (
                <div className="aia-resources-chat-cta">
                  <button
                    className="aia-btn aia-btn--primary aia-btn--full"
                    onClick={() => router.push(`/admin/ai-agents/${agent.id}/chat`)}
                  >
                    💬 Open Chat with {agent.name}
                  </button>
                </div>
              ) : hasResources && isIndexingActive ? (
                <div className="aia-resources-chat-cta">
                  <p className="aia-resources-chat-wait" style={{ margin: 0, textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
                    Chat will be available once indexing finishes…
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </main>

      <Footer />

      {canOpenChat && (
        <FloatingChatButton
          agentName={agent.name}
          onClick={() => router.push(`/admin/ai-agents/${agent.id}/chat`)}
        />
      )}

      <ToastContainer position="top-right" autoClose={3000} theme="colored" />
    </div>
  );
}
