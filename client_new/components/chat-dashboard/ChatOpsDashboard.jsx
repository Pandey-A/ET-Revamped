'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import ChatsInbox, { chatDisplayTitle } from '@/components/chat-dashboard/ChatsInbox';
import LeadsPanel from '@/components/chat-dashboard/LeadsPanel';

const AI_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || 'http://localhost:8000';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '▣' },
  { id: 'chats', label: 'Chats', icon: '💬' },
  { id: 'leads', label: 'Leads', icon: '👤' },
  { id: 'agents', label: 'AI Agents', icon: '🤖', href: '/admin/ai-agents/' },
];

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso.replace('Z', '')).toLocaleString();
  } catch {
    return iso;
  }
}

function pctChange(current, prev) {
  if (!prev) return current ? '+100%' : '0%';
  const p = Math.round(((current - prev) / prev) * 100);
  return `${p >= 0 ? '↑' : '↓'} ${Math.abs(p)}%`;
}

function LineChart({ data }) {
  const points = data?.length ? data : [{ date: '-', count: 0 }];
  const max = Math.max(...points.map((d) => d.count), 1);
  const w = 320;
  const h = 120;
  const coords = points.map((d, i) => {
    const x = (i / Math.max(points.length - 1, 1)) * w;
    const y = h - (d.count / max) * (h - 16) - 8;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="cdb-chart-svg" preserveAspectRatio="none">
      <polyline fill="none" stroke="#1B5E20" strokeWidth="2.5" points={coords.join(' ')} />
      {points.map((d, i) => {
        const x = (i / Math.max(points.length - 1, 1)) * w;
        const y = h - (d.count / max) * (h - 16) - 8;
        return <circle key={d.date} cx={x} cy={y} r="4" fill="#1B5E20" />;
      })}
    </svg>
  );
}

function DonutChart({ total, sources }) {
  const items = sources?.length ? sources : [{ source: 'Website Widget', count: total, percent: 100 }];
  let offset = 0;
  const colors = ['#1B5E20', '#2E7D32', '#43A047', '#66BB6A'];
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="cdb-donut-wrap">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e8f5e9" strokeWidth="14" />
        {items.map((item, i) => {
          const dash = (item.percent / 100) * c;
          const el = (
            <circle
              key={item.source}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth="14"
              strokeDasharray={`${dash} ${c}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="cdb-donut-center">
        <span className="cdb-donut-total">{total}</span>
        <span className="cdb-donut-label">Leads</span>
      </div>
    </div>
  );
}

export default function ChatOpsDashboard() {
  const { user } = useAuth();
  const [view, setView] = useState('dashboard');
  const [stats, setStats] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, sessionsRes, leadsRes] = await Promise.all([
        fetch(`${AI_API}/dashboard/stats?days=30`),
        fetch(`${AI_API}/dashboard/sessions?limit=200`),
        fetch(`${AI_API}/leads`),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (sessionsRes.ok) setSessions(await sessionsRes.json());
      if (leadsRes.ok) setLeads(await leadsRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const t = setInterval(loadData, 30000);
    return () => clearInterval(t);
  }, [loadData]);

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    const qDigits = q.replace(/\D/g, '');
    return sessions.filter((s) => {
      const c = s.contact || {};
      const title = chatDisplayTitle(s).toLowerCase();
      const textMatch =
        title.includes(q) ||
        s.agent_name?.toLowerCase().includes(q) ||
        s.channel_label?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.name?.toLowerCase().includes(q) ||
        s.summary?.toLowerCase().includes(q);
      if (textMatch) return true;
      if (qDigits.length >= 3) {
        const phoneDigits = (c.phone || title).replace(/\D/g, '');
        return phoneDigits.includes(qDigits);
      }
      return false;
    });
  }, [sessions, search]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const exportCsv = () => {
    const rows = [
      ['contact', 'channel', 'agent', 'status', 'name', 'email', 'phone', 'messages', 'started', 'completed', 'summary'],
      ...filteredSessions.map((s) => [
        chatDisplayTitle(s),
        s.channel_label || s.channel,
        s.agent_name || '—',
        s.status,
        s.contact?.name || '',
        s.contact?.email || '',
        s.contact?.phone || '',
        s.message_count,
        s.started_at,
        s.completed_at || '',
        (s.summary || '').replace(/\n/g, ' '),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalChats = stats?.total_chats ?? 0;
  const totalLeads = stats?.total_leads ?? stats?.leads_with_contact ?? 0;
  const completed = stats?.completed_chats ?? 0;
  const daily = stats?.daily_chats ?? [];

  return (
    <div className="cdb-root">
      <aside className="cdb-sidebar">
        <div className="cdb-logo">
          <img
            src="/chatops-icon.png"
            alt="ChatOps"
            className="cdb-logo-img"
            width={44}
            height={44}
          />
          <span className="cdb-logo-text">ChatOps</span>
        </div>
        <nav className="cdb-nav">
          {NAV.map((item) =>
            item.href ? (
              <Link key={item.id} href={item.href} className="cdb-nav-item">
                <span>{item.icon}</span> {item.label}
              </Link>
            ) : (
              <button
                key={item.id}
                type="button"
                className={`cdb-nav-item ${view === item.id ? 'cdb-nav-item--active' : ''}`}
                onClick={() => setView(item.id)}
              >
                <span>{item.icon}</span> {item.label}
              </button>
            )
          )}
        </nav>
        <div className="cdb-sidebar-foot">
          <Link href="/admin/" className="cdb-nav-item">← Admin home</Link>
        </div>
      </aside>

      <div className="cdb-main">
        <header className={`cdb-topbar ${view === 'chats' ? 'cdb-topbar--chats' : ''}`}>
          {view !== 'chats' && (
            <input
              type="search"
              className="cdb-search"
              placeholder="Search chats, leads, agents…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          {view === 'chats' && (
            <span className="cdb-topbar-chats-label">Chat monitoring</span>
          )}
          <div className="cdb-topbar-right">
            <button type="button" className="cdb-icon-btn" title="Refresh" onClick={loadData}>↻</button>
            <div className="cdb-user">
              <span className="cdb-avatar">{(user?.userName || 'A')[0]}</span>
              <span>{user?.userName || 'Admin'}</span>
            </div>
          </div>
        </header>

        {view === 'dashboard' && (
          <div className="cdb-content">
            <div className="cdb-page-head">
              <div>
                <h1>{greeting}, {user?.userName || 'Admin'} 👋</h1>
                <p>Here&apos;s your widget chat overview for today.</p>
              </div>
              <div className="cdb-head-actions">
                <span className="cdb-filter-pill">Last 30 days</span>
                <span className="cdb-filter-pill">Website Widget</span>
                <button type="button" className="cdb-btn-primary" onClick={exportCsv}>
                  ↓ Export CSV
                </button>
              </div>
            </div>

            {loading && <p className="cdb-muted cdb-loading">Loading dashboard…</p>}

            <div className="cdb-kpi-row">
              <div className="cdb-kpi cdb-kpi--primary">
                <div className="cdb-kpi-top">
                  <span>💬 Total Chats</span>
                  <span className="cdb-kpi-link">↗</span>
                </div>
                <div className="cdb-kpi-value">{totalChats}</div>
                <div className="cdb-kpi-trend cdb-kpi-trend--up">
                  {daily.length >= 2 ? pctChange(daily[daily.length - 1]?.count, daily[daily.length - 2]?.count) : '—'} vs prior day
                </div>
              </div>
              <div className="cdb-kpi">
                <div className="cdb-kpi-top"><span>👤 New Leads</span></div>
                <div className="cdb-kpi-value cdb-kpi-value--green">{totalLeads}</div>
                <div className="cdb-kpi-trend cdb-kpi-trend--up">With contact info</div>
              </div>
              <div className="cdb-kpi">
                <div className="cdb-kpi-top"><span>✓ Completed</span></div>
                <div className="cdb-kpi-value cdb-kpi-value--green">{completed}</div>
                <div className="cdb-kpi-trend">WhatsApp sent: {stats?.whatsapp_summaries_sent ?? 0}</div>
              </div>
            </div>

            <div className="cdb-charts-row">
              <div className="cdb-card cdb-card--chart">
                <h3>Chat overview</h3>
                <p className="cdb-card-sub">Total chats over the last 7 days</p>
                <LineChart data={daily} />
                <div className="cdb-chart-labels">
                  {daily.map((d) => (
                    <span key={d.date}>{d.date?.slice(5)}</span>
                  ))}
                </div>
              </div>
              <div className="cdb-card cdb-card--chart">
                <h3>Leads by source</h3>
                <p className="cdb-card-sub">Where your leads are coming from</p>
                <div className="cdb-donut-row">
                  <DonutChart total={totalLeads} sources={stats?.sources} />
                  <ul className="cdb-legend">
                    {(stats?.sources || []).map((s) => (
                      <li key={s.source}>
                        <span className="cdb-legend-dot" />
                        <span>{s.source}</span>
                        <strong>{s.percent}% ({s.count})</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="cdb-metrics-row">
              <div className="cdb-metric">
                <span className="cdb-metric-label">Active chats</span>
                <span className="cdb-metric-value">{stats?.active_chats ?? 0}</span>
                <span className="cdb-metric-trend">Live sessions</span>
              </div>
              <div className="cdb-metric">
                <span className="cdb-metric-label">Resolved chats</span>
                <span className="cdb-metric-value">{completed}</span>
                <span className="cdb-metric-trend cdb-metric-trend--up">Completed</span>
              </div>
              <div className="cdb-metric">
                <span className="cdb-metric-label">Leads w/ contact</span>
                <span className="cdb-metric-value">{stats?.leads_with_contact ?? 0}</span>
                <span className="cdb-metric-trend cdb-metric-trend--up">Captured</span>
              </div>
              <div className="cdb-metric">
                <span className="cdb-metric-label">Conversion rate</span>
                <span className="cdb-metric-value">
                  {totalChats ? `${Math.round((totalLeads / totalChats) * 1000) / 10}%` : '0%'}
                </span>
                <span className="cdb-metric-trend">Leads / chats</span>
              </div>
            </div>

            <div className="cdb-card">
              <div className="cdb-recent-head">
                <h3>Recent chats</h3>
                <button type="button" className="cdb-link-btn" onClick={() => setView('chats')}>
                  View all →
                </button>
              </div>
              <table className="cdb-table">
                <thead>
                  <tr>
                    <th>Contact</th>
                    <th>Agent</th>
                    <th>Channel</th>
                    <th>Msgs</th>
                    <th>Status</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.slice(0, 8).map((s) => (
                    <tr
                      key={s.session_id}
                      className="cdb-table-row-click"
                      onClick={() => setView('chats')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setView('chats')}
                    >
                      <td><strong>{chatDisplayTitle(s)}</strong></td>
                      <td>{s.agent_name || '—'}</td>
                      <td>{s.channel_label || '—'}</td>
                      <td>{s.message_count ?? 0}</td>
                      <td><span className={`cdb-badge cdb-badge--${s.status}`}>{s.status}</span></td>
                      <td>{formatDate(s.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === 'chats' && (
          <div className="cdb-content cdb-content--inbox">
            <ChatsInbox
              sessions={sessions}
              loading={loading}
              search={search}
              onSearchChange={setSearch}
              onRefresh={loadData}
            />
          </div>
        )}

        {view === 'leads' && (
          <div className="cdb-content cdb-content--leads">
            <LeadsPanel
              leads={leads}
              sessions={sessions}
              loading={loading}
              onRefresh={loadData}
            />
          </div>
        )}
      </div>

    </div>
  );
}
