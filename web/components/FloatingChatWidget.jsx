'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const ENV_AI_AGENT_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || 'http://localhost:8000';
const ENV_AI_AGENT_API_LOCAL =
  process.env.NEXT_PUBLIC_AI_AGENT_API_URL_LOCAL || 'http://127.0.0.1:8000';

function isLocalHost(hostname = '') {
  const h = String(hostname).toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function generateAnonSessionId() {
  return `anon_${new Date().toISOString().slice(0, 10)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getStoredSession() {
  try { return localStorage.getItem('et_chat_session'); } catch { return null; }
}

function storeSession(sid) {
  try { localStorage.setItem('et_chat_session', sid); } catch {}
}

function getStoredMessages() {
  try {
    const raw = localStorage.getItem('et_chat_messages');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function storeMessages(msgs) {
  try { localStorage.setItem('et_chat_messages', JSON.stringify(msgs.slice(-50))); } catch {}
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function FloatingChatWidget() {
  const { user } = useAuth();
  const pathname = usePathname();
  const AI_AGENT_API = useMemo(() => {
    if (typeof window === 'undefined') return ENV_AI_AGENT_API;
    return isLocalHost(window.location.hostname) ? ENV_AI_AGENT_API_LOCAL : ENV_AI_AGENT_API;
  }, []);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [agentId, setAgentId] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [leadCaptured, setLeadCaptured] = useState(false);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leadForm, setLeadForm] = useState({ name: '', email: '', phone: '' });
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Voice Feature States ──
  const [isRecording, setIsRecording] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const recognitionRef = useRef(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const wsRef = useRef(null);

  // Pre-fill user data if logged in
  useEffect(() => {
    if (user && user.email) {
      setLeadForm(f => ({
        ...f,
        name: user.userName || f.name,
        email: user.email || f.email
      }));
    }
  }, [user]);

  // ── Initialize session & fetch agent on mount
  useEffect(() => {
    // Session
    let sid = getStoredSession();
    if (!sid) {
      sid = generateAnonSessionId();
      storeSession(sid);
    }
    setSessionId(sid);

    // Restore messages
    const stored = getStoredMessages();
    if (stored.length) setMessages(stored);

    // Check if lead already captured
    try {
      if (localStorage.getItem('et_lead_captured') === 'true') setLeadCaptured(true);
    } catch {}

    // Fetch first available agent
    const fetchAgent = async () => {
      try {
        const resp = await fetch(`${AI_AGENT_API}/agents`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          setAgentId(data[0].id);
        }
      } catch {}
    };
    fetchAgent();
  }, []);

  // ── Persist messages
  useEffect(() => {
    if (messages.length) storeMessages(messages);
  }, [messages]);

  // ── Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
      setUnreadCount(0);
    }
  }, [isOpen]);

  // ── WebSocket for real-time messages
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let reconnectTimer = null;

    const connectWs = () => {
      try {
        const apiUrl = new URL(AI_AGENT_API);
        const wsProtocol = apiUrl.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${wsProtocol}://${apiUrl.host}/ws?session_id=${encodeURIComponent(sessionId)}`;
        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onmessage = (event) => {
          if (event.data === 'ping') return;
          try {
            const data = JSON.parse(event.data);
            if (data.session_id && data.session_id !== sessionId) return;
            if (!data.message) return;
            setMessages(prev => [
              ...prev,
              {
                id: Date.now() + Math.random(),
                role: (data.agent_name || '').toLowerCase() === 'user' ? 'user' : 'assistant',
                content: data.message,
                timestamp: new Date().toISOString(),
              },
            ]);
            if (!isOpen) setUnreadCount(c => c + 1);
          } catch {}
        };

        socket.onclose = () => {
          if (stopped) return;
          reconnectTimer = setTimeout(connectWs, 5000);
        };
      } catch {}
    };

    connectWs();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [sessionId]);

  // ── Check if we should prompt for lead info (after 3 user messages)
  useEffect(() => {
    if (leadCaptured) return;
    const userMsgCount = messages.filter(m => m.role === 'user').length;
    if (userMsgCount >= 4 && !showLeadForm) {
      setShowLeadForm(true);
    }
  }, [messages, leadCaptured, showLeadForm]);

  // ── Send message
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !sessionId) return;

    setInput('');
    setStreaming(true);

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    const aiMsgId = Date.now() + 1;
    setMessages(prev => [
      ...prev,
      { id: aiMsgId, role: 'assistant', content: '', timestamp: new Date().toISOString(), streaming: true },
    ]);

    try {
      const res = await fetch(`${AI_AGENT_API}/chat/stream/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_input: text,
          session_id: sessionId,
          agent_id: agentId || 'default-agent',
        }),
      });

      if (!res.ok) throw new Error(`Backend ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        const lines = chunk.split('\n');
        for (const line of lines) {
          let content = '';
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              content = parsed.content || '';
            } catch { content = line.slice(6); }
          } else {
            content = line;
          }
          fullResponse += content;
          setMessages(prev =>
            prev.map(m => (m.id === aiMsgId ? { ...m, content: fullResponse, streaming: true } : m))
          );
        }
      }

      setMessages(prev =>
        prev.map(m => (m.id === aiMsgId ? { ...m, content: fullResponse || '(no response)', streaming: false } : m))
      );

      // Speak response if voice is enabled
      if (voiceEnabled && fullResponse) {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(fullResponse);
          window.speechSynthesis.speak(utterance);
        }
      }

      // Fire-and-forget analyze_action
      fetch(`${AI_AGENT_API}/chat/analyze_action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_input: text,
          assistant_response: fullResponse,
          session_id: sessionId,
          agent_id: agentId || 'default-agent',
        }),
      }).catch(() => {});

    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === aiMsgId ? { ...m, content: '⚠️ Could not connect to the assistant. Please try again.', streaming: false } : m
        )
      );
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, sessionId, agentId]);

  // ── Submit lead form
  const submitLead = useCallback(async () => {
    if (!leadForm.name && !leadForm.email && !leadForm.phone) return;
    setLeadSubmitting(true);

    try {
      const resp = await fetch(`${AI_AGENT_API}/leads/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          name: leadForm.name,
          email: leadForm.email,
          phone: leadForm.phone,
        }),
      });

      if (resp.ok) {
        setLeadCaptured(true);
        setShowLeadForm(false);
        try { localStorage.setItem('et_lead_captured', 'true'); } catch {}
        setMessages(prev => [
          ...prev,
          {
            id: Date.now(),
            role: 'assistant',
            content: `Thanks${leadForm.name ? ` ${leadForm.name}` : ''}! Our team will reach out to you shortly. 🙌`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch {} finally {
      setLeadSubmitting(false);
    }
  }, [leadForm, sessionId]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    const newSid = generateAnonSessionId();
    storeSession(newSid);
    setSessionId(newSid);
    setMessages([]);
    setLeadCaptured(false);
    setShowLeadForm(false);
    setLeadForm({ name: '', email: '', phone: '' });
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    try {
      localStorage.removeItem('et_chat_messages');
      localStorage.removeItem('et_lead_captured');
    } catch {}
  };

  // ── Voice Input (Speech-to-Text) ──
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsRecording(false);
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert('Voice input is not supported in your browser.');
      return;
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => setIsRecording(true);
    
    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setInput((prev) => (prev ? prev + ' ' + finalTranscript : finalTranscript));
      }
    };

    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);

    try {
      recognition.start();
    } catch (err) {
      setIsRecording(false);
    }
  }, [isRecording]);

  const hideWidget =
    pathname?.startsWith('/admin') ||
    pathname?.startsWith('/chat-dashboard');

  // ── Render ─────────────────────────────────────────────────────────────────
  if (hideWidget) return null;

  return (
    <>
      {/* Floating Bubble */}
      {!isOpen && (
        <button
          id="et-chat-bubble"
          className="et-float-bubble"
          onClick={() => setIsOpen(true)}
          aria-label="Open chat"
        >
          <img src="/favicons/favicon.svg" alt="Chattiq AI" style={{ width: '36px', height: '36px', backgroundColor: 'white', borderRadius: '50%', padding: '4px' }} />
          {unreadCount > 0 && (
            <span className="et-float-badge">{unreadCount}</span>
          )}
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div className="et-float-panel" role="dialog" aria-label="Chat with AI Assistant">
          {/* Header */}
          <div className="et-float-header">
            <div className="et-float-header-info">
              <div className="et-float-header-avatar">
                <img src="/favicons/favicon.svg" alt="AI Avatar" style={{ width: '26px', height: '26px', backgroundColor: 'white', borderRadius: '50%', padding: '2px' }} />
              </div>
              <div>
                <div className="et-float-header-title">Chattiq AI</div>
                <div className="et-float-header-status">
                  <span className="et-float-status-dot" /> Online
                </div>
              </div>
            </div>
            <div className="et-float-header-actions">
              <button 
                onClick={() => setVoiceEnabled(!voiceEnabled)} 
                className={`et-float-header-btn ${voiceEnabled ? 'et-float-header-btn--active' : ''}`} 
                title={voiceEnabled ? "Mute AI Voice" : "Enable AI Voice"}
              >
                {voiceEnabled ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <line x1="23" y1="9" x2="17" y2="15"></line>
                    <line x1="17" y1="9" x2="23" y2="15"></line>
                  </svg>
                )}
              </button>
              <button onClick={clearChat} className="et-float-header-btn" title="New chat">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
              </button>
              <button onClick={() => setIsOpen(false)} className="et-float-header-btn" title="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="et-float-messages">
            {messages.length === 0 && (
              <div className="et-float-welcome">
                <div className="et-float-welcome-icon">👋</div>
                <p className="et-float-welcome-title">Hi there!</p>
                <p className="et-float-welcome-sub">
                  Ask me anything about Chattiq — AI agents, WhatsApp setup, web widgets, or credits.
                </p>
                <div className="et-float-suggestions">
                  <button 
                    className="et-float-suggestion-chip" 
                    onClick={() => { setInput("How do I create an AI agent?"); setTimeout(sendMessage, 50); }}
                  >
                    How do I scan a video?
                  </button>
                  <button 
                    className="et-float-suggestion-chip" 
                    onClick={() => { setInput("Can you verify a YouTube link?"); setTimeout(sendMessage, 50); }}
                  >
                    Can you verify a YouTube link?
                  </button>
                  <button 
                    className="et-float-suggestion-chip" 
                    onClick={() => { setInput("How do I connect WhatsApp?"); setTimeout(sendMessage, 50); }}
                  >
                    What do you detect?
                  </button>
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`et-float-msg ${msg.role === 'user' ? 'et-float-msg--user' : 'et-float-msg--ai'}`}
              >
                <div className={`et-float-msg-bubble ${msg.role === 'user' ? 'et-float-msg-bubble--user' : 'et-float-msg-bubble--ai'}`}>
                  {msg.content.split('\n').map((line, i) => (
                    <span key={i}>{line}<br /></span>
                  ))}
                  {msg.streaming && <span className="et-float-cursor">▋</span>}
                </div>
              </div>
            ))}

            {streaming && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="et-float-msg et-float-msg--ai">
                <div className="et-float-msg-bubble et-float-msg-bubble--ai et-float-typing">
                  <span /><span /><span />
                </div>
              </div>
            )}

            {/* Lead Form */}
            {showLeadForm && !leadCaptured && (
              <div className="et-float-lead-card">
                <div className="et-float-lead-title">💡 Want us to follow up?</div>
                <p className="et-float-lead-sub">Share your details and our team will get back to you.</p>
                <input
                  type="text"
                  placeholder="Your name"
                  value={leadForm.name}
                  onChange={(e) => setLeadForm(f => ({ ...f, name: e.target.value }))}
                  className="et-float-lead-input"
                />
                <input
                  type="email"
                  placeholder="Email address"
                  value={leadForm.email}
                  onChange={(e) => setLeadForm(f => ({ ...f, email: e.target.value }))}
                  className="et-float-lead-input"
                />
                <input
                  type="tel"
                  placeholder="Phone number"
                  value={leadForm.phone}
                  onChange={(e) => setLeadForm(f => ({ ...f, phone: e.target.value }))}
                  className="et-float-lead-input"
                />
                <div className="et-float-lead-actions">
                  <button onClick={submitLead} disabled={leadSubmitting} className="et-float-lead-btn">
                    {leadSubmitting ? 'Sending...' : 'Submit'}
                  </button>
                  <button onClick={() => setShowLeadForm(false)} className="et-float-lead-dismiss">
                    Maybe later
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="et-float-input-area">
            <button 
              onClick={toggleRecording} 
              className={`et-float-mic-btn ${isRecording ? 'et-float-mic-btn--active' : ''}`}
              title="Speak"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              className="et-float-input"
              disabled={streaming}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || streaming}
              className="et-float-send-btn"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>

          {/* Footer */}
          <div className="et-float-footer">
            Powered by <strong>Chattiq</strong>
          </div>
        </div>
      )}
    </>
  );
}
