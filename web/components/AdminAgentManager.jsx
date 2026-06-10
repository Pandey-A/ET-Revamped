'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';

const ENV_AI_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || '';
const API_CANDIDATES = [
  ENV_AI_API,
  'http://127.0.0.1:8010',
  'http://localhost:8010',
  'http://127.0.0.1:8000',
  'http://localhost:8000',
].filter(Boolean);

async function resolveApiBase() {
  for (const base of API_CANDIDATES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(`${base}/chat/session`, {
        method: 'POST',
        signal: controller.signal,
      });
      if (res.ok) {
        clearTimeout(timeout);
        return base;
      }
    } catch (_) {
      // Try next candidate.
    } finally {
      clearTimeout(timeout);
    }
  }
  return ENV_AI_API || 'http://127.0.0.1:8010';
}

export default function AdminAgentManager() {
  const [agents, setAgents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [viewAgent, setViewAgent] = useState(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    agentName: '',
    description: '',
    greetings: '',
    guardrails: '',
  });

  const router = useRouter();

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const apiBase = await resolveApiBase();
        const response = await axios.get(`${apiBase}/agents`);
        if (Array.isArray(response.data) && response.data.length > 0) {
          setAgents(response.data);
          localStorage.setItem('ai_agents', JSON.stringify(response.data));
        } else {
          // Fallback to local storage if backend is empty
          const stored = localStorage.getItem('ai_agents');
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) setAgents(parsed);
          }
        }
      } catch (e) {
        console.error('Failed to fetch agents from backend, falling back to local storage', e);
        const stored = localStorage.getItem('ai_agents');
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) setAgents(parsed);
          } catch (err) {}
        }
      }
    };
    fetchAgents();
  }, []);

  const saveAgentsLocally = (newAgents) => {
    localStorage.setItem('ai_agents', JSON.stringify(newAgents));
  };

  const resetForm = () => {
    setForm({ agentName: '', description: '', greetings: '', guardrails: '' });
    setEditingAgent(null);
  };

  const filteredAgents = agents
    .filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => b.id.localeCompare(a.id));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { agentName, description, greetings, guardrails } = form;
    if (!agentName.trim() || !description.trim() || !greetings.trim() || !guardrails.trim()) {
      alert('Please fill all fields');
      return;
    }

    if (editingAgent) {
      const updated = agents.map((a) =>
        a.id === editingAgent.id
          ? { ...a, name: agentName.trim(), description: description.trim(), greetings: greetings.trim(), guardrails: guardrails.trim() }
          : a
      );
      setAgents(updated);
      saveAgentsLocally(updated);
      resetForm();
      setShowCreateModal(false);
      return;
    }

    const newAgent = {
      id: crypto.randomUUID(),
      name: agentName.trim(),
      description: description.trim(),
      greetings: greetings.trim(),
      guardrails: guardrails.trim(),
    };

    const updated = [newAgent, ...agents];
    setAgents(updated);
    saveAgentsLocally(updated);
    setLoading(true);

    try {
      const apiBase = await resolveApiBase();
      await axios.post(`${apiBase}/store/agents`, newAgent);
      console.log('Agent saved to backend');
    } catch (err) {
      console.error('Error saving agent to backend:', err);
    } finally {
      setLoading(false);
      resetForm();
      setShowCreateModal(false);
    }
  };

  const handleDelete = (id) => {
    if (!confirm('Delete this agent?')) return;
    const updated = agents.filter((a) => a.id !== id);
    setAgents(updated);
    saveAgentsLocally(updated);
  };

  const openEdit = (agent) => {
    setForm({
      agentName: agent.name,
      description: agent.description,
      greetings: agent.greetings,
      guardrails: agent.guardrails,
    });
    setEditingAgent(agent);
    setShowCreateModal(true);
  };

  return (
    <div className="ai-agent-manager">
      {/* Header */}
      <div className="ai-agent-header">
        <div>
          <h2>AI Agents</h2>
          <p>Create and manage your AI-powered agents</p>
        </div>
        <button className="ai-btn ai-btn-primary" onClick={() => { resetForm(); setShowCreateModal(true); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Create Agent
        </button>
      </div>

      {/* Search */}
      <div className="ai-agent-search-bar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ai-search-icon">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          placeholder="Search agents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Agent Cards */}
      {filteredAgents.length > 0 ? (
        <div className="ai-agent-grid">
          {filteredAgents.map((agent) => (
            <div key={agent.id} className="ai-agent-card">
              <div className="ai-agent-card-header">
                <div className="ai-agent-avatar">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/>
                    <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
                  </svg>
                </div>
                <div className="ai-agent-card-info">
                  <h3>{agent.name}</h3>
                  <span className="ai-agent-id">ID: {agent.id.slice(0, 8)}...</span>
                </div>
              </div>

              <p className="ai-agent-desc">{agent.description.length > 120 ? agent.description.slice(0, 120) + '...' : agent.description}</p>

              {agent.greetings && (
                <div className="ai-agent-meta">
                  <span className="ai-agent-meta-label">Greeting:</span>
                  <span>{agent.greetings.length > 60 ? agent.greetings.slice(0, 60) + '...' : agent.greetings}</span>
                </div>
              )}

              <div className="ai-agent-card-actions">
                <button className="ai-btn ai-btn-outline" onClick={() => setViewAgent(agent)}>View</button>
                <button className="ai-btn ai-btn-outline" onClick={() => router.push(`/admin/ai-agents/resources?agent=${agent.name}&agentId=${agent.id}`)}>Resources</button>
                <button className="ai-btn ai-btn-ghost" onClick={() => openEdit(agent)}>Edit</button>
                <button className="ai-btn ai-btn-danger-ghost" onClick={() => handleDelete(agent.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ai-agent-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
            <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/>
            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
          </svg>
          <h3>No agents yet</h3>
          <p>{searchQuery ? 'No agents match your search' : 'Create an agent to get started'}</p>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="ai-modal-overlay" onClick={() => { setShowCreateModal(false); resetForm(); }}>
          <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header">
              <h3>{editingAgent ? 'Edit Agent' : 'Create Agent'}</h3>
              <button className="ai-modal-close" onClick={() => { setShowCreateModal(false); resetForm(); }}>&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="ai-modal-form">
              <div className="ai-form-group">
                <label>Agent Name</label>
                <input type="text" placeholder="e.g. SupportBot" value={form.agentName} onChange={(e) => setForm({ ...form, agentName: e.target.value })} />
              </div>
              <div className="ai-form-group">
                <label>Description</label>
                <textarea placeholder="Describe what this agent does..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
              </div>
              <div className="ai-form-group">
                <label>Greeting Message</label>
                <textarea placeholder="Hello! I'm here to help you..." value={form.greetings} onChange={(e) => setForm({ ...form, greetings: e.target.value })} rows={2} />
              </div>
              <div className="ai-form-group">
                <label>Guardrails</label>
                <textarea placeholder="What the agent should avoid answering..." value={form.guardrails} onChange={(e) => setForm({ ...form, guardrails: e.target.value })} rows={2} />
              </div>
              <button type="submit" className="ai-btn ai-btn-primary ai-btn-full" disabled={loading}>
                {loading ? 'Saving...' : editingAgent ? 'Update Agent' : 'Create Agent'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* View Detail Modal */}
      {viewAgent && (
        <div className="ai-modal-overlay" onClick={() => setViewAgent(null)}>
          <div className="ai-modal ai-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header">
              <h3>Agent: {viewAgent.name}</h3>
              <button className="ai-modal-close" onClick={() => setViewAgent(null)}>&times;</button>
            </div>
            <div className="ai-modal-body">
              <div className="ai-detail-section">
                <h4>Description</h4>
                <p>{viewAgent.description}</p>
              </div>
              <div className="ai-detail-section">
                <h4>Greeting</h4>
                <p>{viewAgent.greetings}</p>
              </div>
              <div className="ai-detail-section">
                <h4>Guardrails</h4>
                <p>{viewAgent.guardrails}</p>
              </div>
              <div className="ai-detail-section">
                <h4>Agent ID</h4>
                <code className="ai-agent-code">{viewAgent.id}</code>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
