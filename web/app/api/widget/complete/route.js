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

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason : 'inactivity';

  if (!sessionId) {
    return Response.json({ error: 'sessionId required' }, { status: 400, headers: corsHeaders() });
  }

  try {
    const res = await fetch(`${aiBase()}/widget/session/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, reason }),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return Response.json({ error: data.detail || 'Complete failed' }, { status: res.status, headers: corsHeaders() });
    }
    return Response.json(data, { headers: corsHeaders() });
  } catch (e) {
    console.error('[api/widget/complete]', e);
    return Response.json({ error: 'Backend unavailable' }, { status: 502, headers: corsHeaders() });
  }
}
