'use client';
import { useParams } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { toast, ToastContainer } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import "react-toastify/dist/ReactToastify.css";

const AI_AGENT_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || "http://localhost:8000";

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
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type === "application/pdf");
    if (files.length === 0) return toast.error("Only PDF files are accepted.");
    onDrop(files);
  };

  const handleFile = (e) => {
    const files = Array.from(e.target.files).filter((f) => f.type === "application/pdf");
    if (files.length === 0) return toast.error("Please select a PDF file.");
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
  const [indexingTasks, setIndexingTasks] = useState({}); // resource -> taskId

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
    fetch(`${AI_AGENT_API}/agents`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (Array.isArray(data)) {
          const backendAgent = data.find((a) => a.id === id);
          if (backendAgent) {
            setAgent(backendAgent);
            try {
              localStorage.setItem("ai_agents", JSON.stringify(data));
            } catch {}
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
            router.replace("/admin/ai-agents");
          }
          return current;
        });
      }, 3000);
    }
  }, [id, router]);

  // ── Poll background indexing status
  const pollTaskStatus = useCallback((taskId, resourceKey) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${AI_AGENT_API}/index/status/${taskId}`);
        const data = await res.json();

        if (data.status === "success") {
          clearInterval(interval);
          setIndexingTasks((prev) => {
            const updated = { ...prev };
            delete updated[resourceKey];
            return updated;
          });
          toast.success(`"${resourceKey.split("/").pop()}" indexed successfully!`);
        } else if (data.status === "error") {
          clearInterval(interval);
          setIndexingTasks((prev) => {
            const updated = { ...prev };
            delete updated[resourceKey];
            return updated;
          });
          toast.error(`Indexing failed: ${data.message}`);
        }
        // else still processing, keep polling
      } catch {
        // Network error, keep polling
      }
    }, 3000);

    // Stop polling after 5 minutes max
    setTimeout(() => clearInterval(interval), 300000);
  }, []);

  // ── Upload PDF
  const handlePdfDrop = useCallback(async (files) => {
    if (!agent) return;
    setUploadingPdf(true);
    setUploadStage("📤 Uploading file…");
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("collection_name", agent.collection_name);
        formData.append("agent_id", agent.id);

        setUploadStage("📤 Uploading file…");
        const res = await fetch(`${AI_AGENT_API}/index/pdf`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");

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
          setIndexingTasks((prev) => ({ ...prev, [resourceKey]: data.task_id }));
          pollTaskStatus(data.task_id, resourceKey);
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
  }, [agent, pollTaskStatus]);

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
        setIndexingTasks((prev) => ({ ...prev, [resourceKey]: data.task_id }));
        pollTaskStatus(data.task_id, resourceKey);
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
  const activeIndexingCount = Object.keys(indexingTasks).length;

  return (
    <div className="admin-page">
      <Navbar />
      <div className="admin-nav-spacer" />

      <main className="admin-main">
        {/* ── Breadcrumb + Header */}
        <div className="aia-breadcrumb">
          <button onClick={() => router.push("/admin/ai-agents")}>← Back to Agents</button>
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
                PDFs will be chunked, embedded, and stored in the vector DB for RAG retrieval.
              </p>
              <Dropzone onDrop={handlePdfDrop} uploading={uploadingPdf} uploadStage={uploadStage} />
            </div>

            {/* URL Indexing */}
            <div className="aia-resources-section glass-card">
              <h3>🌐 Index a Web Page</h3>
              <p className="aia-resources-sub">
                Crawl and embed the contents of any public web page into this agent&apos;s knowledge base.
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
                        indexingStatus={indexingTasks[r] ? "processing" : "done"}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}

              {/* Quick action to open chat */}
              {hasResources && (
                <div className="aia-resources-chat-cta">
                  <button
                    className="aia-btn aia-btn--primary aia-btn--full"
                    onClick={() => router.push(`/admin/ai-agents/${agent.id}/chat`)}
                  >
                    💬 Open Chat with {agent.name}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />

      {/* ── Floating Chat Button (always visible when resources exist) */}
      {hasResources && (
        <FloatingChatButton
          agentName={agent.name}
          onClick={() => router.push(`/admin/ai-agents/${agent.id}/chat`)}
        />
      )}

      <ToastContainer position="top-right" autoClose={3000} theme="colored" />
    </div>
  );
}
