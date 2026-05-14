'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { useAuth } from '@/context/AuthContext';
import { fetchMyAgents } from '@/lib/api';
import AgentWidgetGeneratorPanel from '@/components/AgentWidgetGeneratorPanel';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const TABS = [
  { id: 'chat', label: 'Chat', desc: 'Talk to this agent in the full chat workspace.' },
  { id: 'knowledge', label: 'Knowledge base', desc: 'Upload PDFs and URLs to ground this agent.' },
  { id: 'widget', label: 'Widget generator', desc: 'Configure and copy embed code for this agent only.' },
];

function AgentHubInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading } = useAuth();
  const id = typeof params?.id === 'string' ? params.id : '';

  const tabParam = searchParams.get('tab');
  const initialTab =
    tabParam === 'chat' || tabParam === 'knowledge' || tabParam === 'widget' ? tabParam : 'chat';

  const [tab, setTab] = useState(initialTab);
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);

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
              <p className="aia-hub-meta">{agent.model || 'gpt-4o-mini'}</p>
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
            <button type="button" className="aia-btn aia-btn--primary" onClick={() => router.push(`/admin/ai-agents/${id}/chat`)}>
              Open chat
            </button>
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
