'use client';

import { useState, useEffect } from 'react';
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

export default function AdminResourceBase() {
  const [documents, setDocuments] = useState([]);
  const [agents, setAgents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadType, setUploadType] = useState('file');
  const [selectedAgent, setSelectedAgent] = useState({ name: '', id: '' });
  const [selectedFile, setSelectedFile] = useState(null);
  const [linkInput, setLinkInput] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const agentName = params.get('agent');
    if (agentName) setAgentFilter(agentName);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('ai_resource_documents');
    if (stored) {
      const parsed = JSON.parse(stored);
      setDocuments(parsed.map((d) => ({ ...d, dateUploaded: new Date(d.dateUploaded) })));
    }
    const storedAgents = localStorage.getItem('ai_agents');
    if (storedAgents) {
      try { setAgents(JSON.parse(storedAgents)); } catch (e) { console.error(e); }
    }
  }, []);

  const saveDocuments = (docs) => localStorage.setItem('ai_resource_documents', JSON.stringify(docs));

  const handleFileUpload = async () => {
    if (!selectedFile) return alert('Select a file');
    if (!selectedAgent.name) return alert('Select an agent');
    const collectionName = `${selectedAgent.name.trim()}_${selectedAgent.id.trim()}`;
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('collection_name', collectionName);
    formData.append('agent_id', selectedAgent.id.trim());
    setUploading(true);
    try {
      const apiBase = await resolveApiBase();
      const res = await axios.post(`${apiBase}/index/pdf`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data.status === 'success') {
        const newDoc = { id: Date.now().toString(), name: selectedFile.name, type: selectedFile.type, size: selectedFile.size, dateUploaded: new Date(), agentName: selectedAgent.name.trim() };
        const updated = [newDoc, ...documents];
        setDocuments(updated);
        saveDocuments(updated);
        alert('File indexed!');
      }
    } catch (err) { alert(err?.response?.data?.error || 'Upload failed'); }
    finally { setUploading(false); setSelectedFile(null); setSelectedAgent({ name: '', id: '' }); setShowUploadModal(false); }
  };

  const handleLinkUpload = async () => {
    if (!linkInput.trim()) return alert('Enter a URL');
    if (!selectedAgent.name) return alert('Select an agent');
    const collectionName = `${selectedAgent.name.trim()}_${selectedAgent.id.trim()}`;
    setUploading(true);
    try {
      const apiBase = await resolveApiBase();
      const res = await axios.post(`${apiBase}/index/url`, { url: linkInput, collection_name: collectionName, agent_id: selectedAgent.id.trim() });
      if (res.data.status === 'success') {
        const newDoc = { id: Date.now().toString(), name: linkInput, type: 'link', url: linkInput, dateUploaded: new Date(), agentName: selectedAgent.name.trim() };
        const updated = [newDoc, ...documents];
        setDocuments(updated);
        saveDocuments(updated);
        alert('URL indexed!');
      }
    } catch (err) { alert(err?.response?.data?.error || 'Failed'); }
    finally { setUploading(false); setLinkInput(''); setSelectedAgent({ name: '', id: '' }); setShowUploadModal(false); }
  };

  const formatSize = (b) => { if (!b) return ''; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; };

  const filtered = documents.filter((d) => d.name.toLowerCase().includes(searchQuery.toLowerCase()) && (!agentFilter || d.agentName.toLowerCase().includes(agentFilter.toLowerCase()))).sort((a, b) => new Date(b.dateUploaded) - new Date(a.dateUploaded));

  return (
    <div className="ai-resource-base">
      <div className="ai-agent-header">
        <div><h2>Resource Base</h2><p>Upload documents and URLs for agent knowledge</p></div>
        <button className="ai-btn ai-btn-primary" onClick={() => setShowUploadModal(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload Resource
        </button>
      </div>
      <div className="ai-resource-filters">
        <div className="ai-agent-search-bar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ai-search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search resources..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <div className="ai-filter-agent"><label>Filter by agent:</label><input type="text" placeholder="Agent name..." value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} /></div>
      </div>
      <div className="ai-resource-list">
        <div className="ai-resource-list-header"><h3>Uploaded Resources</h3><span className="ai-badge">{filtered.length} resources</span></div>
        {filtered.length > 0 ? (
          <div className="ai-resource-items">
            {filtered.map((doc) => (
              <div key={doc.id} className="ai-resource-item">
                <div className="ai-resource-icon">{doc.type === 'link' ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}</div>
                <div className="ai-resource-info"><h4>{doc.name}</h4><div className="ai-resource-meta"><span>Agent: {doc.agentName}</span>{doc.size && <><span>•</span><span>{formatSize(doc.size)}</span></>}<span>•</span><span>{new Date(doc.dateUploaded).toLocaleDateString()}</span></div></div>
                {doc.url && <a href={doc.url} target="_blank" rel="noopener noreferrer" className="ai-btn ai-btn-outline ai-btn-sm">View</a>}
              </div>
            ))}
          </div>
        ) : (
          <div className="ai-agent-empty"><h3>No resources yet</h3><p>{searchQuery || agentFilter ? 'No match' : 'Upload to start building knowledge'}</p></div>
        )}
      </div>
      {showUploadModal && (
        <div className="ai-modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ai-modal-header"><h3>Upload Resource</h3><button className="ai-modal-close" onClick={() => setShowUploadModal(false)}>&times;</button></div>
            <div className="ai-upload-tabs">
              <button className={`ai-upload-tab ${uploadType === 'file' ? 'active' : ''}`} onClick={() => setUploadType('file')}>Upload File</button>
              <button className={`ai-upload-tab ${uploadType === 'link' ? 'active' : ''}`} onClick={() => setUploadType('link')}>Add Link</button>
            </div>
            <div className="ai-modal-form">
              {agents.length === 0 && <div className="ai-alert-warning">No agents found. Create an agent first.</div>}
              <div className="ai-form-group"><label>Select Agent</label>
                <select value={selectedAgent.id} onChange={(e) => { const a = agents.find((x) => x.id === e.target.value); if (a) setSelectedAgent({ name: a.name, id: a.id }); }}>
                  <option value="">Select an Agent</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {uploadType === 'file' ? (<>
                <div className="ai-form-group"><label>Select File</label><input type="file" accept=".pdf,.docx" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} /><span className="ai-form-hint">Supported: PDF, DOCX</span></div>
                <button className="ai-btn ai-btn-primary ai-btn-full" onClick={handleFileUpload} disabled={uploading}>{uploading ? 'Uploading...' : 'Upload File'}</button>
              </>) : (<>
                <div className="ai-form-group"><label>Resource URL</label><input type="url" placeholder="https://example.com" value={linkInput} onChange={(e) => setLinkInput(e.target.value)} /></div>
                <button className="ai-btn ai-btn-primary ai-btn-full" onClick={handleLinkUpload} disabled={uploading}>{uploading ? 'Indexing...' : 'Add Link'}</button>
              </>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
