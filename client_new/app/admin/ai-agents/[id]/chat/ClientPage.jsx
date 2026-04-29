'use client';

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { toast, ToastContainer } from "react-toastify";
import { motion, AnimatePresence } from "framer-motion";
import "react-toastify/dist/ReactToastify.css";

const AI_AGENT_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || "http://localhost:8000";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getAgentFromStorage(id) {
  try {
    const stored = localStorage.getItem("ai_agents");
    if (!stored) return null;
    return JSON.parse(stored).find((a) => a.id === id) || null;
  } catch { return null; }
}

function generateSessionId() {
  return `session_${new Date().toISOString().slice(0, 10)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg, agentName, agentInitial }) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      className={`aia-chat-bubble-wrap ${isUser ? "aia-chat-bubble-wrap--user" : "aia-chat-bubble-wrap--ai"}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {!isUser && (
        <div className="aia-chat-avatar aia-chat-avatar--ai">{agentInitial}</div>
      )}
      <div className={`aia-chat-bubble ${isUser ? "aia-chat-bubble--user" : "aia-chat-bubble--ai"}`}>
        <div className="aia-chat-bubble-content">
          {msg.content.split("\n").map((line, i) => (
            <span key={i}>{line}<br /></span>
          ))}
          {msg.streaming && <span className="aia-chat-cursor">▋</span>}
        </div>
        <div className="aia-chat-bubble-time">
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      {isUser && (
        <div className="aia-chat-avatar aia-chat-avatar--user">You</div>
      )}
    </motion.div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────
function TypingIndicator({ agentInitial }) {
  return (
    <div className="aia-chat-bubble-wrap aia-chat-bubble-wrap--ai">
      <div className="aia-chat-avatar aia-chat-avatar--ai">{agentInitial}</div>
      <div className="aia-chat-bubble aia-chat-bubble--ai aia-chat-bubble--typing">
        <span /><span /><span />
      </div>
    </div>
  );
}

// ─── Main Chat Page ───────────────────────────────────────────────────────────
export default function AgentChatPage() {
  const { id } = useParams();
  const router = useRouter();

  const [agent, setAgent] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [isEscalated, setIsEscalated] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const wsRef = useRef(null);
  const recognitionRef = useRef(null);
  const lastSpokenMessageIdRef = useRef(null);

  // ── Load agent & session
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
            // Also update localStorage
            try {
              localStorage.setItem("ai_agents", JSON.stringify(data));
            } catch {}
          }
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));

    if (!found) {
      // Give backend a chance to respond before showing error
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

    // Ping backend with timeout
    const pingCtrl = new AbortController();
    const pingTimeout = setTimeout(() => pingCtrl.abort(), 3000);
    fetch(`${AI_AGENT_API}/chat/session`, { method: "POST", signal: pingCtrl.signal })
      .then((r) => { if (r.ok) setConnected(true); })
      .catch(() => setConnected(false))
      .finally(() => clearTimeout(pingTimeout));
  }, [id, router]);

  // ── Initialize session
  useEffect(() => {
    if (!id || !agent) return;
    const storageKey = `session_${id}`;
    let sid = sessionStorage.getItem(storageKey);
    if (!sid) {
      sid = generateSessionId();
      sessionStorage.setItem(storageKey, sid);
    }
    setSessionId(sid);
  }, [id, agent]);

  // ── Load chat history
  useEffect(() => {
    if (!sessionId) return;
    fetch(`${AI_AGENT_API}/chat/history/${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.messages?.length) {
          const mapped = data.messages.map((m, i) => ({
            id: i,
            role: m.agent_name === "User" || m.agent_name === "user" ? "user" : "assistant",
            content: m.message,
            timestamp: m.timestamp || new Date().toISOString(),
          }));
          setMessages(mapped);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  // ── Track escalation status
  useEffect(() => {
    if (!sessionId) return;
    fetch(`${AI_AGENT_API}/chat/is_escalated/${sessionId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        setIsEscalated(Boolean(data?.escalated));
      })
      .catch(() => setIsEscalated(false));
  }, [sessionId]);

  // ── User websocket for escalation events and human/telegram replies
  useEffect(() => {
    if (!sessionId) return;

    let reconnectTimer = null;
    let stopped = false;

    const connectWs = () => {
      const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
      const apiUrl = new URL(AI_AGENT_API);
      const wsUrl = `${wsProtocol}://${apiUrl.host}/ws?session_id=${encodeURIComponent(sessionId)}`;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onmessage = (event) => {
        if (event.data === "ping") return;
        try {
          const data = JSON.parse(event.data);
          if (data.session_id && data.session_id !== sessionId) return;

          if (data.escalated === true) {
            setIsEscalated(true);
            toast.info("Escalated to human support. Messages now route via Telegram/human agent.");
            return;
          }

          if (!data.message) return;
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              role: (data.agent_name || "").toLowerCase() === "user" ? "user" : "assistant",
              content: data.message,
              timestamp: data.timestamp || new Date().toISOString(),
            },
          ]);
        } catch {
          // Ignore non-json events
        }
      };

      socket.onclose = () => {
        if (stopped) return;
        reconnectTimer = setTimeout(connectWs, 5000);
      };
    };

    connectWs();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [sessionId]);

  // ── Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send message (streaming SSE)
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !agent || !sessionId) return;

    setInput("");
    setStreaming(true);

    const userMsg = {
      id: Date.now(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // Streaming placeholder
    const aiMsgId = Date.now() + 1;
    const aiPlaceholder = {
      id: aiMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      streaming: true,
    };
    setMessages((prev) => [...prev, aiPlaceholder]);

    try {
      if (isEscalated) {
        await fetch(`${AI_AGENT_API}/tickets/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            message: text,
            agent_name: "user",
            agent_id: agent.id,
          }),
        });

        setMessages((prev) =>
          prev.filter((m) => m.id !== aiMsgId)
        );
        return;
      }

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const res = await fetch(`${AI_AGENT_API}/chat/stream/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: text,
          session_id: sessionId,
          agent_id: agent.id,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) throw new Error(`Backend returned ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        // Handle SSE-style "data: {...}" or raw text
        const lines = chunk.split("\n");
        for (const line of lines) {
          let content = "";
          if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6));
              content = parsed.content || "";
            } catch { content = line.slice(6); }
          } else {
            content = line;
          }
          fullResponse += content;

          // Update streaming message
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMsgId ? { ...m, content: fullResponse, streaming: true } : m
            )
          );
        }
      }

      // Finalise
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId ? { ...m, content: fullResponse || "(no response)", streaming: false } : m
        )
      );

      // Post-process (fire-and-forget)
      fetch(`${AI_AGENT_API}/chat/analyze_action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_input: text,
          assistant_response: fullResponse,
          session_id: sessionId,
          agent_id: agent.id,
        }),
      }).catch(() => {});
    } catch (err) {
      if (err.name !== "AbortError") {
        toast.error("Could not reach the AI backend. Make sure it is running.");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: "⚠️ Error: Could not connect to the AI backend.", streaming: false }
              : m
          )
        );
      }
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, agent, sessionId, isEscalated]);

  // ── Browser speech-to-text
  const toggleListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast.error("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => setIsListening(true);
    rec.onend = () => setIsListening(false);
    rec.onerror = () => {
      setIsListening(false);
      toast.error("Voice capture failed. Please try again.");
    };
    rec.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
      if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };

    recognitionRef.current = rec;
    rec.start();
  }, [isListening]);

  // ── Browser text-to-speech for assistant replies
  useEffect(() => {
    if (!voiceEnabled || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.streaming || !last.content) return;
    if (lastSpokenMessageIdRef.current === last.id) return;

    lastSpokenMessageIdRef.current = last.id;
    const utterance = new SpeechSynthesisUtterance(last.content);
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [messages, voiceEnabled]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    const sid = generateSessionId();
    setMessages([]);
    setIsEscalated(false);
    setSessionId(sid);
    sessionStorage.setItem(`session_${id}`, sid);
  };

  if (!agent) {
    return (
      <div className="admin-page admin-page--status">
        <Navbar />
        <div className="admin-nav-spacer" />
        <div className="admin-status-card">Loading chat…</div>
      </div>
    );
  }

  const agentInitial = agent.name?.[0]?.toUpperCase() || "A";

  return (
    <div className="aia-chat-page">
      <Navbar />
      <div className="admin-nav-spacer" />

      <div className="aia-chat-layout">
        {/* ── Sidebar */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              className="aia-chat-sidebar"
              initial={{ x: -280, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="aia-chat-sidebar-header">
                <button className="aia-back-btn" onClick={() => router.push("/admin/ai-agents")}>
                  ← Agents
                </button>
              </div>

              {/* Agent Info */}
              <div className="aia-chat-agent-info">
                <div className="aia-chat-agent-avatar">{agentInitial}</div>
                <div>
                  <h3>{agent.name}</h3>
                  <span className={`aia-status-pill ${connected ? "aia-status-pill--online" : "aia-status-pill--offline"}`}>
                    {connected ? "● Online" : "○ Offline"}
                  </span>
                </div>
              </div>

              <div className="aia-chat-sidebar-section">
                <p className="aia-chat-sidebar-label">Model</p>
                <p className="aia-chat-sidebar-value">{agent.model || "gpt-4o-mini"}</p>
              </div>
              <div className="aia-chat-sidebar-section">
                <p className="aia-chat-sidebar-label">Knowledge Base</p>
                <p className="aia-chat-sidebar-value">
                  {agent.resource_list?.length || 0} resource{agent.resource_list?.length !== 1 ? "s" : ""}
                </p>
              </div>
              {agent.resource_list?.length > 0 && (
                <div className="aia-chat-sidebar-resources">
                  {agent.resource_list.slice(0, 5).map((r, i) => (
                    <div key={i} className="aia-chat-sidebar-resource">
                      <span>📄</span>
                      <span>{r.split("/").pop()}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="aia-chat-sidebar-actions">
                <button
                  className="aia-btn aia-btn--secondary aia-btn--sm"
                  onClick={() => router.push(`/admin/ai-agents/${agent.id}/resources`)}
                >
                  📚 Manage Knowledge
                </button>
                <button className="aia-btn aia-btn--ghost aia-btn--sm" onClick={clearChat}>
                  🗑 New Session
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ── Chat Area */}
        <div className="aia-chat-main">
          {/* ── Chat Topbar */}
          <div className="aia-chat-topbar">
            <button
              className="aia-sidebar-toggle"
              onClick={() => setSidebarOpen((p) => !p)}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              ☰
            </button>
            <div className="aia-chat-topbar-info">
              <span className="aia-chat-topbar-avatar">{agentInitial}</span>
              <div>
                <span className="aia-chat-topbar-name">{agent.name}</span>
                <span className="aia-chat-topbar-sub">
                  {isEscalated
                    ? "Escalated to human support"
                    : streaming
                      ? "Thinking…"
                      : connected
                        ? "Ready to chat"
                        : "Backend offline"}
                </span>
              </div>
            </div>
            <div className="aia-chat-topbar-right">
              {isEscalated && (
                <span className="aia-offline-badge">📲 Telegram/Human Mode</span>
              )}
              {!connected && (
                <span className="aia-offline-badge">⚠ Backend Offline</span>
              )}
            </div>
          </div>

          {/* ── Messages */}
          <div className="aia-chat-messages">
            {messages.length === 0 && (
              <div className="aia-chat-welcome">
                <div className="aia-chat-welcome-avatar">{agentInitial}</div>
                <h2>Hi, I&apos;m {agent.name}!</h2>
                <p>
                  {agent.description || "I'm your AI assistant. Ask me anything based on the documents in my knowledge base."}
                </p>
                <div className="aia-chat-welcome-hints">
                  <span>💡 Try asking about your uploaded documents</span>
                  <span>🔍 I use RAG to search my knowledge base</span>
                </div>
              </div>
            )}

            <AnimatePresence>
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  agentName={agent.name}
                  agentInitial={agentInitial}
                />
              ))}
            </AnimatePresence>

            {streaming && messages[messages.length - 1]?.streaming === false && (
              <TypingIndicator agentInitial={agentInitial} />
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Input Bar */}
          <div className="aia-chat-input-bar">
            <div className="aia-chat-input-wrap">
              <textarea
                ref={inputRef}
                className="aia-chat-input"
                placeholder={`Message ${agent.name}… (Enter to send, Shift+Enter for new line)`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={streaming}
              />
              <button
                className="aia-chat-send-btn"
                onClick={toggleListening}
                disabled={streaming}
                title={isListening ? "Stop voice input" : "Start voice input"}
                aria-label={isListening ? "Stop voice input" : "Start voice input"}
              >
                {isListening ? "◼" : "🎤"}
              </button>
              <button
                className="aia-chat-send-btn"
                onClick={() => setVoiceEnabled((v) => !v)}
                title={voiceEnabled ? "Disable voice replies" : "Enable voice replies"}
                aria-label={voiceEnabled ? "Disable voice replies" : "Enable voice replies"}
              >
                {voiceEnabled ? "🔊" : "🔈"}
              </button>
              <button
                className={`aia-chat-send-btn ${streaming ? "aia-chat-send-btn--loading" : ""}`}
                onClick={sendMessage}
                disabled={streaming || !input.trim()}
                aria-label="Send message"
              >
                {streaming ? <span className="aia-spinner aia-spinner--sm" /> : "➤"}
              </button>
            </div>
            <p className="aia-chat-input-hint">
              {isEscalated ? "Escalated: messages are routed to human support" : "RAG-powered"} · Knowledge base: {agent.resource_list?.length || 0} docs · Session: {sessionId?.slice(-8)}
            </p>
          </div>
        </div>
      </div>

      <ToastContainer position="top-right" autoClose={3000} theme="colored" />
    </div>
  );
}
