import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
/** @type {Map<string, { count: number, resetAt: number }>} */
const rateBuckets = new Map();

function getClientIp(request) {
  const xf = request.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, b);
  }
  b.count += 1;
  if (b.count > RATE_LIMIT_MAX) return false;
  if (rateBuckets.size > 20_000) rateBuckets.clear();
  return true;
}

function corsHeaders() {
  const origin = process.env.WIDGET_CHAT_CORS_ORIGIN || '*';
  /** @type {Record<string, string>} */
  const h = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (origin !== '*') {
    h.Vary = 'Origin';
  }
  return h;
}

function resolveAiAgentBase() {
  return (process.env.AI_AGENT_API_URL || process.env.NEXT_PUBLIC_AI_AGENT_API_URL || 'http://127.0.0.1:8000').replace(
    /\/$/,
    ''
  );
}

/**
 * FastAPI `POST /chat/stream/chat` returns `text/event-stream`; `agent_response_generator_chat` yields raw text chunks.
 * @param {string} base
 * @param {string} userInput
 * @param {string} sessionId
 * @param {string} agentId
 */
async function streamChatToReply(base, userInput, sessionId, agentId) {
  const res = await fetch(`${base}/chat/stream/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_input: userInput,
      session_id: sessionId,
      agent_id: agentId,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`stream ${res.status}: ${t.slice(0, 400)}`);
  }
  if (!res.body) throw new Error('no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
  }

  const trimmed = full.trim();
  if (!trimmed) return '(no response)';

  if (trimmed.includes('data: ')) {
    let extracted = '';
    for (const line of trimmed.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        extracted += parsed.content != null ? String(parsed.content) : '';
      } catch {
        extracted += payload;
      }
    }
    const reply = extracted.trim();
    return reply || trimmed;
  }

  return trimmed;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: corsHeaders() });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders() });
  }

  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  let sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

  if (!agentId || !message) {
    return Response.json({ error: 'agentId and message required' }, { status: 400, headers: corsHeaders() });
  }
  if (message.length > 8000) {
    return Response.json({ error: 'message too long' }, { status: 400, headers: corsHeaders() });
  }
  if (!sessionId) sessionId = `widget_${agentId}_${randomUUID()}`;

  const base = resolveAiAgentBase();

  try {
    const agentsRes = await fetch(`${base}/agents`, { cache: 'no-store' });
    if (!agentsRes.ok) {
      return Response.json({ error: 'Agent registry unavailable' }, { status: 503, headers: corsHeaders() });
    }
    const agents = await agentsRes.json();
    if (!Array.isArray(agents)) {
      return Response.json({ error: 'Invalid agent registry' }, { status: 503, headers: corsHeaders() });
    }
    const agent = agents.find((a) => a && a.id === agentId);
    if (!agent) {
      return Response.json({ error: 'Unknown agent' }, { status: 404, headers: corsHeaders() });
    }
    if (agent.public_embed === false) {
      return Response.json({ error: 'Embeds disabled for this agent' }, { status: 403, headers: corsHeaders() });
    }

    const reply = await streamChatToReply(base, message, sessionId, agentId);
    return Response.json({ reply }, { status: 200, headers: corsHeaders() });
  } catch (e) {
    console.error('[api/widget/chat]', e);
    return Response.json(
      { error: 'Assistant unavailable', reply: 'The assistant is temporarily unavailable. Please try again later.' },
      { status: 502, headers: corsHeaders() }
    );
  }
}
