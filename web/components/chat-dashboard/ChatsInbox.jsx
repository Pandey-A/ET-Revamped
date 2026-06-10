'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const AI_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || 'http://localhost:8000';

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso.replace('Z', ''));
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatShortDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso.replace('Z', ''));
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  } catch {
    return '';
  }
}

export function parseWhatsAppPhone(session) {
  const c = session?.contact || {};
  if (c.phone?.trim()) return formatDisplayPhone(c.phone.trim());
  const sid = session?.session_id || '';
  if (!sid.startsWith('whatsapp_')) return '';
  const parts = sid.split('_');
  if (parts.length < 4) return '';
  return formatDisplayPhone(parts[parts.length - 1]);
}

function formatDisplayPhone(raw) {
  const s = String(raw).trim();
  if (!s) return '';
  if (s.startsWith('+')) return s;
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 8) return `+${digits}`;
  return s;
}

export function chatDisplayTitle(session) {
  const c = session?.contact || {};
  if (c.name?.trim()) return c.name.trim();
  const phone = c.phone?.trim() ? formatDisplayPhone(c.phone) : parseWhatsAppPhone(session);
  if (phone) return phone;
  if (c.email?.trim()) return c.email.trim();
  if (session?.channel === 'ai_agent') return 'Test conversation';
  if (session?.channel === 'whatsapp') return 'Unknown number';
  return 'Website visitor';
}

function avatarInitials(session) {
  const title = chatDisplayTitle(session);
  const digits = title.replace(/\D/g, '');
  if (digits.length >= 2) return digits.slice(-2);
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (title[0] || '?').toUpperCase();
}

function chatPreview(session, messages) {
  if (session?.summary?.trim()) {
    return session.summary.slice(0, 80) + (session.summary.length > 80 ? '…' : '');
  }
  const last = [...(messages || [])].reverse().find((m) => {
    const r = String(m.role || '').toLowerCase();
    return m.content?.trim() && r !== 'system';
  });
  if (last?.content) {
    const t = last.content.trim();
    return t.slice(0, 72) + (t.length > 72 ? '…' : '');
  }
  return 'No messages yet';
}

function statusLabel(status) {
  if (status === 'completed') return { text: 'Completed', tone: 'done' };
  return { text: 'Active', tone: 'active' };
}

function digitsOnly(str) {
  return String(str || '').replace(/\D/g, '');
}

/** Client-side search across contact, agent, channel, summary, and cached previews */
function sessionMatchesSearch(session, query, previewText = '') {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const c = session?.contact || {};
  const title = chatDisplayTitle(session);
  const textFields = [
    title,
    c.name,
    c.email,
    c.phone,
    session?.agent_name,
    session?.channel_label,
    session?.channel,
    session?.summary,
    previewText,
  ]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase());

  if (textFields.some((f) => f.includes(q))) return true;

  const qDigits = digitsOnly(q);
  if (qDigits.length >= 3) {
    const phoneSources = [c.phone, title, parseWhatsAppPhone(session)].filter(Boolean);
    if (phoneSources.some((p) => digitsOnly(p).includes(qDigits))) return true;
  }

  return false;
}

function isUserMessage(role) {
  const r = String(role || '').toLowerCase();
  return r === 'user' || r.includes('user');
}

function normalizeMessages(messages) {
  return (messages || []).filter((m) => {
    const content = (m.content || '').trim();
    if (!content) return false;
    const r = String(m.role || '').toLowerCase();
    if (r === 'system' && content.toLowerCase().includes('error')) return false;
    return true;
  });
}

function groupByAgent(sessions, agentMap) {
  const groups = new Map();
  for (const s of sessions) {
    const agentId = s.agent_id || '';
    const agentName =
      s.agent_name?.trim() ||
      agentMap.get(agentId)?.name ||
      (agentId ? 'AI Agent' : 'General inbox');
    const key = agentId || '__general__';
    if (!groups.has(key)) {
      groups.set(key, { agentId: key === '__general__' ? '' : agentId, agentName, chats: [] });
    }
    groups.get(key).chats.push(s);
  }
  for (const g of groups.values()) {
    g.chats.sort(
      (a, b) =>
        new Date(b.last_activity_at || b.started_at || 0) -
        new Date(a.last_activity_at || a.started_at || 0)
    );
  }
  return [...groups.values()].sort((a, b) => b.chats.length - a.chats.length);
}

function ContactAvatar({ session, className = '' }) {
  const initials = avatarInitials(session);
  const isWa = session?.channel === 'whatsapp';
  return (
    <div
      className={`cdb-chat-avatar ${isWa ? 'cdb-chat-avatar--wa' : ''} ${className}`}
      aria-hidden
    >
      {isWa ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

function ConversationPanel({ detail, loading, agentName }) {
  if (loading) {
    return (
      <div className="cdb-inbox-main cdb-inbox-main--empty">
        <div className="cdb-chat-skeleton" />
        <p>Loading conversation…</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="cdb-inbox-main cdb-inbox-main--empty">
        <img src="/chatops-icon.png" alt="" className="cdb-inbox-empty-logo" width={64} height={64} />
        <h3>Select a conversation</h3>
        <p>Pick a chat from the list to read the full thread.</p>
      </div>
    );
  }

  const session = detail.session || {};
  const messages = normalizeMessages(detail.messages);
  const title = chatDisplayTitle(session);
  const subtitle = [agentName || session.agent_name, session.channel_label].filter(Boolean).join(' · ');

  return (
    <div className="cdb-inbox-main">
      <header className="cdb-inbox-conv-head">
        <ContactAvatar session={session} className="cdb-chat-avatar--lg" />
        <div className="cdb-inbox-conv-head-text">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <span className="cdb-inbox-ai-pill">AI</span>
      </header>

      <div className="cdb-inbox-messages">
        {messages.length === 0 && (
          <div className="cdb-inbox-messages-empty">
            <p>No messages in this thread yet.</p>
          </div>
        )}
        {messages.map((m, i) => {
          const isUser = isUserMessage(m.role);
          return (
            <div
              key={i}
              className={`cdb-inbox-bubble-row ${isUser ? 'cdb-inbox-bubble-row--user' : 'cdb-inbox-bubble-row--ai'}`}
            >
              {!isUser && (
                <div className="cdb-inbox-bot-avatar">
                  <img src="/chatops-icon.png" alt="" width={32} height={32} />
                </div>
              )}
              <div className={`cdb-inbox-bubble ${isUser ? 'cdb-inbox-bubble--user' : 'cdb-inbox-bubble--ai'}`}>
                <p>{m.content}</p>
              </div>
              {isUser && (
                <div className="cdb-inbox-user-avatar">{avatarInitials(session)}</div>
              )}
            </div>
          );
        })}
      </div>

      {session.summary && (
        <details className="cdb-inbox-summary-fold">
          <summary>Conversation summary</summary>
          <p>{session.summary}</p>
        </details>
      )}

      <div className="cdb-inbox-composer">
        <div className="cdb-inbox-composer-inner">
          <input
            type="text"
            className="cdb-inbox-composer-input"
            placeholder="Messaging disabled in admin view"
            disabled
            readOnly
          />
          <button type="button" className="cdb-inbox-composer-send" disabled aria-label="Send">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
        <p className="cdb-inbox-composer-hint">Powered by Chattiq</p>
      </div>
    </div>
  );
}

export default function ChatsInbox({
  sessions,
  loading,
  search = '',
  onSearchChange = () => {},
  onRefresh,
}) {
  const [agents, setAgents] = useState([]);
  const [selectedAgentKey, setSelectedAgentKey] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [channelFilter, setChannelFilter] = useState('all');
  const [previews, setPreviews] = useState({});

  useEffect(() => {
    fetch(`${AI_API}/agents`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => setAgents([]));
  }, []);

  const agentMap = useMemo(() => {
    const m = new Map();
    agents.forEach((a) => {
      if (a?.id) m.set(a.id, a);
    });
    return m;
  }, [agents]);

  const isSearching = search.trim().length > 0;

  const filteredSessions = useMemo(() => {
    let list = sessions;
    const q = search.trim();
    if (q) {
      list = list.filter((s) =>
        sessionMatchesSearch(s, q, previews[s.session_id] || '')
      );
    }
    if (channelFilter !== 'all') {
      list = list.filter((s) => s.channel === channelFilter);
    }
    return list;
  }, [sessions, search, channelFilter, previews]);

  const agentGroups = useMemo(
    () => groupByAgent(filteredSessions, agentMap),
    [filteredSessions, agentMap]
  );

  const displayGroups = useMemo(() => {
    if (!isSearching) return agentGroups;
    if (!filteredSessions.length) return [];
    return [
      {
        agentId: '__search__',
        agentName: `Results (${filteredSessions.length})`,
        chats: filteredSessions,
      },
    ];
  }, [isSearching, agentGroups, filteredSessions]);

  useEffect(() => {
    if (!displayGroups.length) {
      setSelectedAgentKey(null);
      return;
    }
    const keyFor = (g) => g.agentId || '__general__';
    if (
      !selectedAgentKey ||
      !displayGroups.find((g) => keyFor(g) === selectedAgentKey)
    ) {
      setSelectedAgentKey(keyFor(displayGroups[0]));
    }
  }, [displayGroups, selectedAgentKey]);

  const activeGroup = useMemo(() => {
    const keyFor = (g) => g.agentId || '__general__';
    return (
      displayGroups.find((g) => keyFor(g) === selectedAgentKey) ||
      displayGroups[0] ||
      null
    );
  }, [displayGroups, selectedAgentKey]);

  useEffect(() => {
    if (!activeGroup?.chats?.length) {
      setSelectedSessionId(null);
      return;
    }
    const stillThere = activeGroup.chats.some((c) => c.session_id === selectedSessionId);
    if (!stillThere) {
      setSelectedSessionId(activeGroup.chats[0].session_id);
    }
  }, [activeGroup, selectedSessionId]);

  const loadDetail = useCallback((sessionId) => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    fetch(`${AI_API}/dashboard/sessions/${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((data) => {
        setDetail(data);
        const msgs = data.messages || [];
        if (msgs.length) {
          setPreviews((p) => ({
            ...p,
            [sessionId]: chatPreview(data.session, msgs),
          }));
        }
      })
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    loadDetail(selectedSessionId);
  }, [selectedSessionId, loadDetail]);

  const channels = useMemo(() => {
    const set = new Set(sessions.map((s) => s.channel).filter(Boolean));
    return ['all', ...set];
  }, [sessions]);

  return (
    <div className="cdb-inbox">
      <header className="cdb-inbox-top">
        <div className="cdb-inbox-top-left">
          <h1>Conversations</h1>
          {/* <p>By agent · names &amp; phone numbers only</p> */}
        </div>
        <input
          type="search"
          className="cdb-inbox-search"
          placeholder="Search name or phone…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <button type="button" className="cdb-inbox-new-btn" onClick={onRefresh}>
          ↻ Refresh
        </button>
      </header>

      <div className="cdb-inbox-agents-bar">
        {!isSearching &&
          agentGroups.map((g) => {
            const key = g.agentId || '__general__';
            const active = key === selectedAgentKey;
            return (
              <button
                key={key}
                type="button"
                className={`cdb-inbox-agent-tab ${active ? 'cdb-inbox-agent-tab--active' : ''}`}
                onClick={() => setSelectedAgentKey(key)}
              >
                <span className="cdb-inbox-agent-tab-name">{g.agentName}</span>
                <span className="cdb-inbox-agent-tab-count">{g.chats.length}</span>
              </button>
            );
          })}
        {isSearching && filteredSessions.length > 0 && (
          <span className="cdb-inbox-search-hint">
            Showing {filteredSessions.length} match{filteredSessions.length !== 1 ? 'es' : ''} across all agents
          </span>
        )}
        {!loading && !isSearching && !agentGroups.length && (
          <span className="cdb-muted cdb-inbox-agents-empty">No conversations yet</span>
        )}
      </div>

      <div className="cdb-inbox-split">
        <aside className="cdb-inbox-history">
          <div className="cdb-inbox-history-head">
            <span className="cdb-inbox-history-title-label">Chats</span>
            <select
              className="cdb-inbox-filter"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              aria-label="Filter by channel"
            >
              {channels.map((ch) => (
                <option key={ch} value={ch}>
                  {ch === 'all' ? 'All' : ch.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="cdb-inbox-history-list">
            {loading && (
              <div className="cdb-inbox-pad">
                <div className="cdb-chat-skeleton cdb-chat-skeleton--line" />
                <div className="cdb-chat-skeleton cdb-chat-skeleton--line" />
              </div>
            )}
            {!loading && isSearching && !filteredSessions.length && (
              <p className="cdb-muted cdb-inbox-pad">No chats match &ldquo;{search.trim()}&rdquo;</p>
            )}
            {!loading && !isSearching && !activeGroup?.chats?.length && (
              <p className="cdb-muted cdb-inbox-pad">No chats for this agent.</p>
            )}
            {activeGroup?.chats.map((chat) => {
              const id = chat.session_id;
              const active = id === selectedSessionId;
              const st = statusLabel(chat.status);
              const preview = previews[id] || chat.summary?.slice(0, 72) || 'Tap to open';
              const time = formatTime(chat.last_activity_at || chat.started_at);
              return (
                <button
                  key={id}
                  type="button"
                  className={`cdb-inbox-history-item ${active ? 'cdb-inbox-history-item--active' : ''}`}
                  onClick={() => setSelectedSessionId(id)}
                >
                  <ContactAvatar session={chat} />
                  <div className="cdb-inbox-history-item-body">
                    <div className="cdb-inbox-history-item-top">
                      <span className="cdb-inbox-history-item-name">{chatDisplayTitle(chat)}</span>
                      <span className="cdb-inbox-history-item-time">{time || formatShortDate(chat.started_at)}</span>
                    </div>
                    <div className="cdb-inbox-history-item-preview">{preview}</div>
                    <div className="cdb-inbox-history-item-meta">
                      <span className={`cdb-inbox-status cdb-inbox-status--${st.tone}`}>{st.text}</span>
                      {isSearching && chat.agent_name && (
                        <span>{chat.agent_name}</span>
                      )}
                      <span>{chat.message_count || 0} msgs</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <ConversationPanel
          detail={detail}
          loading={detailLoading}
          agentName={activeGroup?.agentName}
        />
      </div>
    </div>
  );
}
