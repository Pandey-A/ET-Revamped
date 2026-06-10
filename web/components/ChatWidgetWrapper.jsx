'use client';

import dynamic from 'next/dynamic';
import { useAuth } from '@/context/AuthContext';

import { useState, useEffect } from 'react';

const ENV_AI_API = process.env.NEXT_PUBLIC_AI_AGENT_API_URL || '';
const STATIC_API_CANDIDATES = ['http://127.0.0.1:8010', 'http://localhost:8010', 'http://127.0.0.1:8000', 'http://localhost:8000'];

function getApiCandidates() {
  const hostCandidates = [];
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const host = window.location.hostname;
    hostCandidates.push(`http://${host}:8010`, `http://${host}:8000`);
  }
  return [...new Set([ENV_AI_API, ...hostCandidates, ...STATIC_API_CANDIDATES].filter(Boolean))];
}

// Dynamically import the chat widget to avoid SSR issues with WebSocket/sessionStorage
const AIChatWidget = dynamic(() => import('@/components/AIChatWidget'), { ssr: false });

export default function ChatWidgetWrapper() {
  const { isAuthenticated } = useAuth();
  const [activeAgentId, setActiveAgentId] = useState('default-agent');

  useEffect(() => {
    const fetchFirstAgent = async () => {
      try {
        for (const base of getApiCandidates()) {
          const response = await fetch(`${base}/agents`);
          if (!response.ok) continue;
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            setActiveAgentId(data[0].id);
            localStorage.setItem('ai_agents', JSON.stringify(data));
            return;
          }
        }
      } catch (e) {
        console.error('Failed to fetch agents from backend', e);
      }
      // Fallback
      const stored = localStorage.getItem('ai_agents');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setActiveAgentId(parsed[0].id);
          }
        } catch (e) { console.error(e); }
      }
    };
    fetchFirstAgent();
  }, []);
  
  // Only show chat widget for authenticated users
  if (!isAuthenticated) return null;
  
  return <AIChatWidget agentId={activeAgentId} />;
}
