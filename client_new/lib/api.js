import axios from 'axios';
import { getAccessToken, getAuthHeaderObject } from './authToken';

function isLoopbackHost(h) {
  if (!h) return false;
  const x = String(h).toLowerCase();
  return x === 'localhost' || x === '127.0.0.1' || x === '[::1]' || x === '::1';
}

function tryParseUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Same-origin cookies: API host must match the page host (localhost vs 127.0.0.1 matters).
 * NEXT_PUBLIC_API_URL_LOCAL wins. For loopback/LAN we rewrite loopback env hosts to the tab hostname.
 */
function resolveApiBaseUrl() {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';
  }

  const { protocol, hostname } = window.location;
  const pageHost = hostname.toLowerCase();
  const defaultPort = process.env.NEXT_PUBLIC_API_PORT || '5001';

  if (process.env.NEXT_PUBLIC_API_URL_LOCAL) {
    return process.env.NEXT_PUBLIC_API_URL_LOCAL.replace(/\/$/, '');
  }

  const pageIsLoopback = isLoopbackHost(pageHost);
  const pageIsPrivateLan =
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(pageHost) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(pageHost) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(pageHost);

  const u = tryParseUrl(process.env.NEXT_PUBLIC_API_URL);

  if (pageIsLoopback) {
    if (u && !isLoopbackHost(u.hostname)) {
      return u.toString().replace(/\/$/, '');
    }
    if (u && isLoopbackHost(u.hostname)) {
      const port = u.port || defaultPort;
      const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '/api';
      return `${protocol}//${pageHost}:${port}${path.startsWith('/') ? path : `/${path}`}`;
    }
    return `${protocol}//${pageHost}:${defaultPort}/api`;
  }

  if (pageIsPrivateLan) {
    if (u && !isLoopbackHost(u.hostname) && u.hostname.toLowerCase() !== pageHost) {
      return u.toString().replace(/\/$/, '');
    }
    if (u && isLoopbackHost(u.hostname)) {
      const port = u.port || defaultPort;
      const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '/api';
      return `${protocol}//${pageHost}:${port}${path.startsWith('/') ? path : `/${path}`}`;
    }
    if (u && u.hostname.toLowerCase() === pageHost) {
      return u.toString().replace(/\/$/, '');
    }
    return `${protocol}//${pageHost}:${defaultPort}/api`;
  }

  // Public hostname (e.g. production): never fall back to localhost — the browser cannot reach the server's localhost.
  if (u) return u.toString().replace(/\/$/, '');
  return `${protocol}//${pageHost}/api`;
}

const api = axios.create({
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  config.baseURL = resolveApiBaseUrl();
  const t = getAccessToken();
  if (t) {
    config.headers = config.headers || {};
    if (!config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${t}`;
    }
  }
  return config;
});

/** Use with plain `fetch()` so the same base URL and auth as axios. */
export function getApiBaseUrl() {
  return resolveApiBaseUrl();
}

/** GET /agents on Express (PostgreSQL-backed, per logged-in user). */
/** GET /credits/me — billing, metrics, recent usage (Redis via FastAPI). */
export async function fetchMyCredits(init = {}) {
  if (typeof window === 'undefined') return null;
  const res = await fetch(`${resolveApiBaseUrl()}/credits/me`, {
    credentials: 'include',
    ...init,
    headers: {
      ...getAuthHeaderObject(),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      /* ignore */
    }
    return { error: message };
  }
  return res.json();
}

export async function fetchMyAgents(init = {}) {
  if (typeof window === 'undefined') return null;
  const res = await fetch(`${resolveApiBaseUrl()}/agents`, {
    credentials: 'include',
    ...init,
    headers: {
      ...getAuthHeaderObject(),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export default api;
