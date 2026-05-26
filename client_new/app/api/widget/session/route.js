import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

function corsHeaders() {
  const origin = process.env.WIDGET_CHAT_CORS_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function aiBase() {
  return (process.env.AI_AGENT_API_URL || process.env.NEXT_PUBLIC_AI_AGENT_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders() });
  }

  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
  let sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const origin = typeof body.origin === 'string' ? body.origin : '';
  const pageUrl = typeof body.pageUrl === 'string' ? body.pageUrl : '';

  if (!agentId) {
    return Response.json({ error: 'agentId required' }, { status: 400, headers: corsHeaders() });
  }
  if (!sessionId) sessionId = `widget_${agentId}_${randomUUID()}`;

  try {
    const res = await fetch(`${aiBase()}/widget/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        agent_id: agentId,
        origin,
        page_url: pageUrl,
      }),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return Response.json({ error: data.detail || 'Session start failed' }, { status: res.status, headers: corsHeaders() });
    }
    return Response.json({ sessionId, session: data.session }, { headers: corsHeaders() });
  } catch (e) {
    console.error('[api/widget/session]', e);
    return Response.json({ error: 'Backend unavailable' }, { status: 502, headers: corsHeaders() });
  }
}
