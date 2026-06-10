'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { useAuth } from '@/context/AuthContext';
import { fetchMyAgents, getApiBaseUrl } from '@/lib/api';
import { getAuthHeaderObject } from '@/lib/authToken';
import AgentWidgetGeneratorPanel from '@/components/AgentWidgetGeneratorPanel';
import { isAgentChatReady } from '@/lib/agentIndexing';
import { useAgentIndexingPoll } from '@/hooks/useAgentIndexingPoll';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const TABS = [
  { id: 'chat', label: 'Chat', desc: 'Talk to this agent in the full chat workspace.' },
  { id: 'knowledge', label: 'Knowledge base', desc: 'Upload PDFs and URLs to ground this agent.' },
  { id: 'settings', label: 'Contact & fallback', desc: 'Company name and escalation emails for widget vs WhatsApp.' },
  { id: 'widget', label: 'Widget generator', desc: 'Configure and copy embed code for this agent only.' },
];

function AgentContactSettings({ agent, onSaved }) {
  const [form, setForm] = useState({
    company_name: agent?.company_name || '',
    widget_contact_email: agent?.widget_contact_email || '',
    whatsapp_contact_email: agent?.whatsapp_contact_email || '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      company_name: agent?.company_name || '',
      widget_contact_email: agent?.widget_contact_email || '',
      whatsapp_contact_email: agent?.whatsapp_contact_email || '',
    });
  }, [agent?.id, agent?.company_name, agent?.widget_contact_email, agent?.whatsapp_contact_email]);

  const handleChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    if (!agent?.id) return;
    setSaving(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/agents/${agent.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaderObject(),
        },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.detail || 'Failed to save');
      toast.success('Contact settings saved');
      onSaved?.(data.agent);
    } catch (err) {
      toast.error(err.message || 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="aia-form" onSubmit={handleSave} style={{ maxWidth: 520 }}>
      <div className="aia-form-group">
        <label>Company name (user-facing)</label>
        <input name="company_name" value={form.company_name} onChange={handleChange} placeholder="e.g. Chattiq" />
        <p className="aia-form-hint">Shown when the bot cannot answer from the knowledge base.</p>
      </div>
      <div className="aia-form-group">
        <label>Widget contact email</label>
        <input
          name="widget_contact_email"
          type="email"
          value={form.widget_contact_email}
          onChange={handleChange}
          placeholder="info@chatiq.co.in"
        />
        <p className="aia-form-hint">Website widget only: transfer message + ask other questions here.</p>
      </div>
      <div className="aia-form-group">
        <label>WhatsApp contact email</label>
        <input
          name="whatsapp_contact_email"
          type="email"
          value={form.whatsapp_contact_email}
          onChange={handleChange}
          placeholder="Optional — can differ from widget"
        />
        <p className="aia-form-hint">WhatsApp only: separate transfer / contact wording.</p>
      </div>
      <button type="submit" className="aia-btn aia-btn--primary" disabled={saving}>
        {saving ? 'Saving…' : 'Save contact settings'}
      </button>
    </form>
  );
}

function AgentHubInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading } = useAuth();
  const id = typeof params?.id === 'string' ? params.id : '';

  const tabParam = searchParams.get('tab');
  const initialTab =
    tabParam === 'chat' || tabParam === 'knowledge' || tabParam === 'settings' || tabParam === 'widget'
      ? tabParam
      : 'chat';

  const [tab, setTab] = useState(initialTab);
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const { pendingCount } = useAgentIndexingPoll(id);
  const canOpenChat = isAgentChatReady(agent);

  useEffect(() => {
    if (!isLoading && !user) {
      window.location.href = '/login/';
    }
  }, [isLoading, user]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const list = await fetchMyAgents();
      const found = Array.isArray(list) ? list.find((a) => a.id === id) : null;
      setAgent(found || null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!isLoading && user?.id) void load();
  }, [isLoading, user?.id, load]);

  if (isLoading || loading) {
    return (
      <div className="admin-page admin-page--status">
        <Navbar />
        <div className="admin-nav-spacer" />
        <div className="admin-status-card">Loading agent…</div>
      </div>
    );
  }

  if (!user) return null;

  if (!agent) {
    return (
      <div className="admin-page">
        <Navbar />
        <div className="admin-nav-spacer" />
        <main className="admin-main">
          <p className="aia-count">Agent not found or you don&apos;t have access.</p>
          <a href="/admin/ai-agents/" className="aia-btn aia-btn--primary" style={{ display: 'inline-block', marginTop: 16 }}>
            ← All agents
          </a>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="admin-page">
      <Navbar />
      <div className="admin-nav-spacer" />

      <main className="admin-main">
        <div className="aia-hub-top">
          <a href="/admin/ai-agents/" className="aia-hub-back">
            ← All agents
          </a>
          <div className="aia-hub-title-row">
            <div className="aia-avatar aia-avatar--lg">{agent.name?.[0]?.toUpperCase() || 'A'}</div>
            <div>
              <p className="admin-kicker" style={{ marginBottom: 4 }}>
                Agent
              </p>
              <h1 style={{ margin: 0, fontSize: 'clamp(1.35rem, 3vw, 1.75rem)' }}>{agent.name}</h1>
              {(agent.company_name || agent.description) && (
                <p className="aia-hub-meta">
                  {agent.company_name || (agent.description?.length > 80 ? `${agent.description.slice(0, 80)}…` : agent.description)}
                </p>
              )}
            </div>
          </div>
        </div>

        <nav className="aia-hub-tabs" aria-label="Agent sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`aia-hub-tab ${tab === t.id ? 'aia-hub-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'chat' && (
          <section className="aia-hub-section">
            <h2 className="aia-hub-section-title">Chat</h2>
            <p className="aia-hub-section-desc">{TABS.find((x) => x.id === 'chat')?.desc}</p>
            {canOpenChat ? (
              <button type="button" className="aia-btn aia-btn--primary" onClick={() => router.push(`/admin/ai-agents/${id}/chat`)}>
                Open chat
              </button>
            ) : (
              <>
                <p className="aia-form-hint" style={{ marginBottom: 12 }}>
                  {(agent?.resource_list?.length ?? 0) === 0
                    ? 'Add and index at least one PDF or URL in the knowledge base before chatting.'
                    : pendingCount > 0
                      ? 'Indexing is still in progress. Chat will be available when indexing finishes.'
                      : 'Chat is not available yet.'}
                </p>
                <button
                  type="button"
                  className="aia-btn aia-btn--primary"
                  disabled
                  style={{ opacity: 0.55, cursor: 'not-allowed' }}
                >
                  Open chat
                </button>
                {(agent?.resource_list?.length ?? 0) === 0 || pendingCount > 0 ? (
                  <button
                    type="button"
                    className="aia-btn"
                    style={{ marginLeft: 12 }}
                    onClick={() => router.push(`/admin/ai-agents/${id}/resources`)}
                  >
                    Go to knowledge base
                  </button>
                ) : null}
              </>
            )}
          </section>
        )}

        {tab === 'knowledge' && (
          <section className="aia-hub-section">
            <h2 className="aia-hub-section-title">Knowledge base</h2>
            <p className="aia-hub-section-desc">{TABS.find((x) => x.id === 'knowledge')?.desc}</p>
            <button
              type="button"
              className="aia-btn aia-btn--primary"
              onClick={() => router.push(`/admin/ai-agents/${id}/resources`)}
            >
              Open knowledge base
            </button>
          </section>
        )}

        {tab === 'settings' && (
          <section className="aia-hub-section">
            <h2 className="aia-hub-section-title">Contact &amp; fallback messages</h2>
            <p className="aia-hub-section-desc">{TABS.find((x) => x.id === 'settings')?.desc}</p>
            <AgentContactSettings agent={agent} onSaved={(updated) => setAgent(updated)} />
          </section>
        )}

        {tab === 'widget' && (
          <section className="aia-hub-section aia-hub-section--flush">
            <h2 className="aia-hub-section-title">Widget generator</h2>
            <p className="aia-hub-section-desc" style={{ marginBottom: 16 }}>
              {TABS.find((x) => x.id === 'widget')?.desc}
            </p>
            <AgentWidgetGeneratorPanel agent={agent} />
          </section>
        )}
      </main>

      <Footer />
      <ToastContainer position="top-right" autoClose={3000} theme="colored" />
    </div>
  );
}

export default function AgentHubPage() {
  return (
    <Suspense
      fallback={
        <div className="admin-page admin-page--status">
          <Navbar />
          <div className="admin-nav-spacer" />
          <div className="admin-status-card">Loading…</div>
        </div>
      }
    >
      <AgentHubInner />
    </Suspense>
  );
}
