'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseWhatsAppPhone } from '@/components/chat-dashboard/ChatsInbox';

const AI_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || 'http://localhost:8000';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso.replace('Z', '')).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function digitsOnly(str) {
  return String(str || '').replace(/\D/g, '');
}

function rowActivityDate(row) {
  const iso = row.captured_at || row.last_activity_at;
  if (!iso) return null;
  try {
    return new Date(iso.replace('Z', ''));
  } catch {
    return null;
  }
}

function startOfDay(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T23:59:59.999');
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function presetDateRange(preset) {
  const today = new Date();
  const end = toISODate(today);
  if (preset === 'all') return { start: '', end: '' };
  if (preset === '7d') {
    const s = new Date(today);
    s.setDate(s.getDate() - 7);
    return { start: toISODate(s), end };
  }
  if (preset === '30d') {
    const s = new Date(today);
    s.setDate(s.getDate() - 30);
    return { start: toISODate(s), end };
  }
  return null;
}

function hasContact(session) {
  const c = session?.contact || {};
  return Boolean(c.name?.trim() || c.email?.trim() || c.phone?.trim());
}

function normalizeCapturedLead(lead, sessionById) {
  const sid = lead.session_id;
  const session = sessionById.get(sid);
  const c = session?.contact || {};
  return {
    id: sid || `lead-${lead.captured_at}`,
    session_id: sid,
    status: 'captured',
    name: lead.name && lead.name !== 'Unknown' ? lead.name : c.name || '',
    email: lead.email && lead.email !== 'Not provided' ? lead.email : c.email || '',
    phone:
      lead.phone && lead.phone !== 'Not provided'
        ? lead.phone
        : c.phone || parseWhatsAppPhone(session || { session_id: sid, channel: 'whatsapp' }),
    summary: lead.summary || session?.summary || '',
    captured_at: lead.captured_at,
    whatsapp_sent: Boolean(lead.whatsapp_sent),
    source: lead.source || session?.channel_label || 'Website Widget',
    agent_name: session?.agent_name || '',
    channel: session?.channel || '',
    message_count: session?.message_count ?? 0,
    last_activity_at: session?.last_activity_at || lead.captured_at,
  };
}

function buildPendingFromSessions(sessions, capturedSessionIds) {
  return sessions
    .filter((s) => s.session_id && !capturedSessionIds.has(s.session_id))
    .filter((s) => (s.message_count || 0) > 0 || hasContact(s))
    .map((s) => {
      const c = s.contact || {};
      const completed = s.status === 'completed';
      return {
        id: s.session_id,
        session_id: s.session_id,
        status: completed ? 'pending_review' : 'pending',
        name: c.name || '',
        email: c.email || '',
        phone: c.phone || parseWhatsAppPhone(s),
        summary: s.summary || '',
        captured_at: null,
        whatsapp_sent: Boolean(s.whatsapp_sent),
        source: s.channel_label || s.channel || 'Chat',
        agent_name: s.agent_name || '',
        channel: s.channel || '',
        message_count: s.message_count ?? 0,
        last_activity_at: s.last_activity_at || s.started_at,
      };
    });
}

function displayName(row) {
  if (row.name?.trim()) return row.name.trim();
  if (row.phone?.trim()) return row.phone.trim();
  if (row.email?.trim()) return row.email.trim();
  return 'Unknown contact';
}

function leadInitials(row) {
  const title = displayName(row);
  const digits = title.replace(/\D/g, '');
  if (digits.length >= 2) return digits.slice(-2);
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (title[0] || '?').toUpperCase();
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

function formatShortTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso.replace('Z', '')).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function rowMatchesFilters(row, filters) {
  const q = filters.search.trim().toLowerCase();
  if (q) {
    const blob = [
      displayName(row),
      row.name,
      row.email,
      row.phone,
      row.agent_name,
      row.source,
      row.summary,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const qDigits = digitsOnly(q);
    if (!blob.includes(q) && !(qDigits.length >= 3 && digitsOnly(row.phone).includes(qDigits))) {
      return false;
    }
  }

  if (filters.tab === 'captured' && row.status !== 'captured') return false;
  if (filters.tab === 'pending' && row.status !== 'pending' && row.status !== 'pending_review') {
    return false;
  }

  if (filters.channel !== 'all' && row.channel !== filters.channel) return false;
  if (filters.agent !== 'all' && row.agent_name !== filters.agent) return false;

  if (filters.phone === 'has' && !row.phone?.trim()) return false;
  if (filters.phone === 'missing' && row.phone?.trim()) return false;

  if (filters.whatsapp === 'sent' && !row.whatsapp_sent) return false;
  if (filters.whatsapp === 'not_sent' && row.whatsapp_sent) return false;

  if (filters.source !== 'all' && row.source !== filters.source) return false;

  const activity = rowActivityDate(row);
  const from = startOfDay(filters.startDate);
  const to = endOfDay(filters.endDate);
  if (from && (!activity || activity < from)) return false;
  if (to && (!activity || activity > to)) return false;

  return true;
}

function countActiveFilters({
  search,
  status,
  sortOrder,
  datePreset,
  channel,
  agent,
  phone,
  whatsapp,
  source,
}) {
  let n = 0;
  if (search?.trim()) n += 1;
  if (status !== 'all') n += 1;
  if (sortOrder !== 'desc') n += 1;
  if (datePreset !== 'all') n += 1;
  if (channel !== 'all') n += 1;
  if (agent !== 'all') n += 1;
  if (phone !== 'all') n += 1;
  if (whatsapp !== 'all') n += 1;
  if (source !== 'all') n += 1;
  return n;
}

function LeadsFiltersDropdown({
  open,
  onToggle,
  onClose,
  activeCount,
  status,
  onStatus,
  sortOrder,
  onSortOrder,
  datePreset,
  onDatePreset,
  startDate,
  endDate,
  onStartDate,
  onEndDate,
  phone,
  onPhone,
  whatsapp,
  onWhatsapp,
  channel,
  onChannel,
  agent,
  onAgent,
  source,
  onSource,
  filterOptions,
  onClear,
}) {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div className="cdb-leads-filter-menu-wrap" ref={rootRef}>
      <button
        type="button"
        className={`cdb-leads-filter-trigger${open ? ' cdb-leads-filter-trigger--open' : ''}${activeCount > 0 ? ' cdb-leads-filter-trigger--active' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        Filters
        {activeCount > 0 && <span className="cdb-leads-filter-badge">{activeCount}</span>}
      </button>
      {open && (
        <div className="cdb-leads-filter-panel" role="dialog" aria-label="Lead filters">
          <div className="cdb-leads-filter-panel-head">
            <span>Filter leads</span>
            {activeCount > 0 && (
              <button type="button" className="cdb-leads-filter-panel-clear" onClick={onClear}>
                Clear all
              </button>
            )}
          </div>
          <div className="cdb-leads-filter-grid">
            <label className="cdb-leads-filter-field">
              <span>Status</span>
              <select value={status} onChange={(e) => onStatus(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="captured">Captured</option>
                <option value="pending">Pending</option>
              </select>
            </label>
            <label className="cdb-leads-filter-field">
              <span>Sort</span>
              <select value={sortOrder} onChange={(e) => onSortOrder(e.target.value)}>
                <option value="desc">New to old</option>
                <option value="asc">Old to new</option>
              </select>
            </label>
            <label className="cdb-leads-filter-field">
              <span>Date range</span>
              <select value={datePreset} onChange={(e) => onDatePreset(e.target.value)}>
                <option value="all">All dates</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="custom">Custom range</option>
              </select>
            </label>
            <label className="cdb-leads-filter-field">
              <span>Phone</span>
              <select value={phone} onChange={(e) => onPhone(e.target.value)}>
                <option value="all">All phones</option>
                <option value="has">Has phone</option>
                <option value="missing">No phone</option>
              </select>
            </label>
            <label className="cdb-leads-filter-field">
              <span>WhatsApp</span>
              <select value={whatsapp} onChange={(e) => onWhatsapp(e.target.value)}>
                <option value="all">All</option>
                <option value="sent">Summary sent</option>
                <option value="not_sent">Not sent</option>
              </select>
            </label>
            <label className="cdb-leads-filter-field">
              <span>Channel</span>
              <select value={channel} onChange={(e) => onChannel(e.target.value)}>
                {filterOptions.channels.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch === 'all' ? 'All channels' : ch.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="cdb-leads-filter-field">
              <span>Agent</span>
              <select value={agent} onChange={(e) => onAgent(e.target.value)}>
                {filterOptions.agents.map((a) => (
                  <option key={a} value={a}>
                    {a === 'all' ? 'All agents' : a}
                  </option>
                ))}
              </select>
            </label>
            <label className="cdb-leads-filter-field">
              <span>Source</span>
              <select value={source} onChange={(e) => onSource(e.target.value)}>
                {filterOptions.sources.map((s) => (
                  <option key={s} value={s}>
                    {s === 'all' ? 'All sources' : s}
                  </option>
                ))}
              </select>
            </label>
            {datePreset === 'custom' && (
              <div className="cdb-leads-filter-field cdb-leads-filter-field--wide">
                <span>Custom dates</span>
                <div className="cdb-leads-date-custom">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => onStartDate(e.target.value)}
                    aria-label="From date"
                  />
                  <span className="cdb-leads-date-custom-sep">to</span>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => onEndDate(e.target.value)}
                    aria-label="To date"
                  />
                </div>
              </div>
            )}
          </div>
          <button type="button" className="cdb-leads-filter-done" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function statusBadge(row) {
  if (row.status === 'captured') {
    return { label: 'Captured', className: 'cdb-lead-badge--captured' };
  }
  if (row.status === 'pending_review') {
    return { label: 'Pending review', className: 'cdb-lead-badge--review' };
  }
  return { label: 'Pending', className: 'cdb-lead-badge--pending' };
}

function LeadAvatar({ lead, large }) {
  const isWa = lead.channel === 'whatsapp';
  return (
    <div
      className={`cdb-leads-detail-avatar${large ? ' cdb-leads-detail-avatar--lg' : ''}${isWa ? ' cdb-leads-detail-avatar--wa' : ''}`}
      aria-hidden
    >
      {isWa ? (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      ) : (
        <span>{leadInitials(lead)}</span>
      )}
    </div>
  );
}

function DetailStat({ label, value, tone }) {
  return (
    <div className={`cdb-leads-detail-stat${tone ? ` cdb-leads-detail-stat--${tone}` : ''}`}>
      <span className="cdb-leads-detail-stat-label">{label}</span>
      <span className="cdb-leads-detail-stat-value">{value}</span>
    </div>
  );
}

function LeadDetailPane({ lead, detail, detailLoading }) {
  if (!lead) {
    return (
      <div className="cdb-leads-detail cdb-leads-detail--empty">
        <img src="/chatops-icon.png" alt="" width={56} height={56} />
        <h3>Select a lead</h3>
        <p>Choose a lead from the list to view full contact details and conversation.</p>
      </div>
    );
  }

  const st = statusBadge(lead);
  const messages = normalizeMessages(detail?.messages);
  const session = detail?.session || {};
  const summary = lead.summary || session.summary || '';

  return (
    <div className="cdb-leads-detail">
      <header className="cdb-leads-detail-head">
        <LeadAvatar lead={lead} large />
        <div className="cdb-leads-detail-head-text">
          <div className="cdb-leads-detail-title-row">
            <h2>{displayName(lead)}</h2>
            <span className={`cdb-lead-badge ${st.className}`}>{st.label}</span>
          </div>
          <p className="cdb-leads-detail-subtitle">
            {[lead.agent_name, lead.source].filter(Boolean).join(' · ') || 'Lead'}
          </p>
        </div>
      </header>

      <div className="cdb-leads-detail-scroll">
        <section className="cdb-leads-detail-section">
          <h3 className="cdb-leads-detail-section-title">Contact</h3>
          <div className="cdb-leads-detail-contact-grid">
            <div className="cdb-leads-detail-contact-item">
              <span className="cdb-lead-label">Phone</span>
              {lead.phone ? (
                <a href={`tel:${lead.phone.replace(/\s/g, '')}`} className="cdb-leads-detail-link">
                  {lead.phone}
                </a>
              ) : (
                <p>—</p>
              )}
            </div>
            <div className="cdb-leads-detail-contact-item">
              <span className="cdb-lead-label">Email</span>
              {lead.email ? (
                <a href={`mailto:${lead.email}`} className="cdb-leads-detail-link">
                  {lead.email}
                </a>
              ) : (
                <p>—</p>
              )}
            </div>
          </div>
        </section>

        <section className="cdb-leads-detail-section">
          <h3 className="cdb-leads-detail-section-title">Overview</h3>
          <div className="cdb-leads-detail-stats">
            <DetailStat label="Messages" value={lead.message_count ?? 0} />
            <DetailStat
              label="WhatsApp"
              value={lead.whatsapp_sent ? 'Summary sent' : 'Not sent'}
              tone={lead.whatsapp_sent ? 'ok' : 'muted'}
            />
            <DetailStat label="Channel" value={lead.source || '—'} />
            <DetailStat label="Agent" value={lead.agent_name || '—'} />
          </div>
        </section>

        <section className="cdb-leads-detail-section">
          <h3 className="cdb-leads-detail-section-title">Activity</h3>
          <dl className="cdb-leads-detail-timeline">
            <div>
              <dt>Captured</dt>
              <dd>{lead.captured_at ? formatDate(lead.captured_at) : 'Not captured yet'}</dd>
            </div>
            <div>
              <dt>Last activity</dt>
              <dd>{formatDate(lead.last_activity_at)}</dd>
            </div>
          </dl>
        </section>

        {summary && (
          <section className="cdb-leads-detail-section">
            <h3 className="cdb-leads-detail-section-title">Conversation summary</h3>
            <div className="cdb-leads-detail-summary-box">
              <p>{summary}</p>
            </div>
          </section>
        )}

        <section className="cdb-leads-detail-section cdb-leads-detail-section--messages">
          <h3 className="cdb-leads-detail-section-title">
            Conversation
            {messages.length > 0 && (
              <span className="cdb-leads-detail-msg-count">{messages.length} messages</span>
            )}
          </h3>
          {detailLoading && (
            <div className="cdb-leads-detail-loading">
              <div className="cdb-chat-skeleton cdb-chat-skeleton--line" />
              <div className="cdb-chat-skeleton cdb-chat-skeleton--line" />
              <p>Loading messages…</p>
            </div>
          )}
          {!detailLoading && !lead.session_id && (
            <p className="cdb-muted">No linked conversation for this lead.</p>
          )}
          {!detailLoading && lead.session_id && messages.length === 0 && (
            <p className="cdb-muted">No messages in this thread yet.</p>
          )}
          {!detailLoading && messages.length > 0 && (
            <div className="cdb-leads-detail-messages">
              {messages.map((m, i) => {
                const isUser = isUserMessage(m.role);
                return (
                  <div
                    key={i}
                    className={`cdb-inbox-bubble-row ${isUser ? 'cdb-inbox-bubble-row--user' : 'cdb-inbox-bubble-row--ai'}`}
                  >
                    {!isUser && (
                      <div className="cdb-inbox-bot-avatar">
                        <img src="/chatops-icon.png" alt="" width={28} height={28} />
                      </div>
                    )}
                    <div className={`cdb-inbox-bubble ${isUser ? 'cdb-inbox-bubble--user' : 'cdb-inbox-bubble--ai'}`}>
                      <p>{m.content}</p>
                    </div>
                    {isUser && (
                      <div className="cdb-inbox-user-avatar">{leadInitials(lead)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function LeadsPanel({ leads, sessions, loading, onRefresh }) {
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [datePreset, setDatePreset] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [channel, setChannel] = useState('all');
  const [agent, setAgent] = useState('all');
  const [phone, setPhone] = useState('all');
  const [whatsapp, setWhatsapp] = useState('all');
  const [source, setSource] = useState('all');
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { allRows, filterOptions } = useMemo(() => {
    const sessionById = new Map();
    (sessions || []).forEach((s) => {
      if (s.session_id) sessionById.set(s.session_id, s);
    });

    const capturedList = Array.isArray(leads) ? leads : [];
    const capturedSessionIds = new Set(
      capturedList.map((l) => l.session_id).filter(Boolean)
    );

    const captured = capturedList.map((l) =>
      normalizeCapturedLead(l, sessionById)
    );
    const pending = buildPendingFromSessions(sessions || [], capturedSessionIds);
    const all = [...captured, ...pending];

    const channels = ['all', ...new Set(all.map((r) => r.channel).filter(Boolean))];
    const agents = ['all', ...new Set(all.map((r) => r.agent_name).filter(Boolean))];
    const sources = ['all', ...new Set(all.map((r) => r.source).filter(Boolean))];

    return {
      allRows: all,
      filterOptions: { channels, agents, sources },
    };
  }, [leads, sessions]);

  const filters = { search, tab: status, channel, agent, phone, whatsapp, source, startDate, endDate };

  const filteredRows = useMemo(() => {
    const rows = allRows.filter((r) => rowMatchesFilters(r, filters));
    return [...rows].sort((a, b) => {
      const ta = rowActivityDate(a)?.getTime() ?? 0;
      const tb = rowActivityDate(b)?.getTime() ?? 0;
      return sortOrder === 'desc' ? tb - ta : ta - tb;
    });
  }, [allRows, search, status, channel, agent, phone, whatsapp, source, startDate, endDate, sortOrder]);

  const onDatePresetChange = (preset) => {
    setDatePreset(preset);
    if (preset === 'custom') return;
    const range = presetDateRange(preset);
    if (range) {
      setStartDate(range.start);
      setEndDate(range.end);
    }
  };

  const exportCsv = () => {
    const rows = [
      ['status', 'name', 'phone', 'email', 'agent', 'channel', 'whatsapp_sent', 'messages', 'captured_at', 'summary'],
      ...filteredRows.map((r) => [
        statusBadge(r).label,
        displayName(r),
        r.phone || '',
        r.email || '',
        r.agent_name || '',
        r.source || '',
        r.whatsapp_sent ? 'yes' : 'no',
        r.message_count,
        r.captured_at || '',
        (r.summary || '').replace(/\n/g, ' '),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const clearFilters = () => {
    setSearch('');
    setStatus('all');
    setSortOrder('desc');
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
    setChannel('all');
    setAgent('all');
    setPhone('all');
    setWhatsapp('all');
    setSource('all');
  };

  const activeFilterCount = countActiveFilters({
    search,
    status,
    sortOrder,
    datePreset,
    channel,
    agent,
    phone,
    whatsapp,
    source,
  });

  const hasActiveFilters = activeFilterCount > 0;

  const selectedLead = useMemo(
    () => filteredRows.find((r) => r.id === selectedLeadId) || null,
    [filteredRows, selectedLeadId]
  );

  useEffect(() => {
    if (!filteredRows.length) {
      setSelectedLeadId(null);
      return;
    }
    const stillVisible = selectedLeadId && filteredRows.some((r) => r.id === selectedLeadId);
    if (!stillVisible) {
      setSelectedLeadId(filteredRows[0].id);
    }
  }, [filteredRows, selectedLeadId]);

  const loadDetail = useCallback((sessionId) => {
    if (!sessionId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    fetch(`${AI_API}/dashboard/sessions/${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setDetail(data))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    loadDetail(selectedLead?.session_id);
  }, [selectedLead?.session_id, loadDetail]);

  return (
    <div className="cdb-leads">
      <header className="cdb-leads-top">
        <div>
          <h1>Leads</h1>
          <p>Captured contacts and chats still waiting for lead capture.</p>
        </div>
        <button type="button" className="cdb-inbox-new-btn" onClick={onRefresh}>
          ↻ Refresh
        </button>
      </header>

      <div className="cdb-leads-filters">
        <input
          type="search"
          className="cdb-leads-search"
          placeholder="Search name, phone, email, agent…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <LeadsFiltersDropdown
          open={filtersOpen}
          onToggle={() => setFiltersOpen((v) => !v)}
          onClose={() => setFiltersOpen(false)}
          activeCount={activeFilterCount - (search?.trim() ? 1 : 0)}
          status={status}
          onStatus={setStatus}
          sortOrder={sortOrder}
          onSortOrder={setSortOrder}
          datePreset={datePreset}
          onDatePreset={onDatePresetChange}
          startDate={startDate}
          endDate={endDate}
          onStartDate={setStartDate}
          onEndDate={setEndDate}
          phone={phone}
          onPhone={setPhone}
          whatsapp={whatsapp}
          onWhatsapp={setWhatsapp}
          channel={channel}
          onChannel={setChannel}
          agent={agent}
          onAgent={setAgent}
          source={source}
          onSource={setSource}
          filterOptions={filterOptions}
          onClear={clearFilters}
        />
        <button type="button" className="cdb-leads-export" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      <div className="cdb-leads-split">
        <aside className="cdb-leads-list-col">
          <div className="cdb-leads-list-head">
            <span>
              {loading ? 'Loading…' : `${filteredRows.length} of ${allRows.length} leads`}
            </span>
          </div>
          <div className="cdb-leads-list">
            {loading && <p className="cdb-muted cdb-leads-pad">Loading leads…</p>}
            {!loading && filteredRows.length === 0 && (
              <p className="cdb-muted cdb-leads-pad">
                {hasActiveFilters
                  ? 'No leads match your filters.'
                  : 'No leads yet. They appear when users share contact details or chats complete.'}
              </p>
            )}
            {!loading &&
              filteredRows.map((row) => {
                const st = statusBadge(row);
                const active = row.id === selectedLeadId;
                const preview = row.summary?.trim() || 'No summary yet';
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`cdb-leads-list-item${active ? ' cdb-leads-list-item--active' : ''}`}
                    onClick={() => setSelectedLeadId(row.id)}
                  >
                    <LeadAvatar lead={row} />
                    <div className="cdb-leads-list-item-body">
                      <div className="cdb-leads-list-item-top">
                        <span className="cdb-leads-list-item-name">{displayName(row)}</span>
                        <span className="cdb-leads-list-item-time">
                          {formatShortTime(row.captured_at || row.last_activity_at)}
                        </span>
                      </div>
                      <p className="cdb-leads-list-item-preview">
                        {preview.slice(0, 72)}
                        {preview.length > 72 ? '…' : ''}
                      </p>
                      <div className="cdb-leads-list-item-meta">
                        <span className={`cdb-lead-badge ${st.className}`}>{st.label}</span>
                        {row.agent_name && <span>{row.agent_name}</span>}
                        {row.whatsapp_sent && <span>WA sent</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </aside>

        <LeadDetailPane
          lead={selectedLead}
          detail={detail}
          detailLoading={detailLoading}
        />
      </div>
    </div>
  );
}
