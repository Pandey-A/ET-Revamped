const STORAGE_KEY = 'et_access_token_v1';

export function getAccessToken() {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token) {
  if (typeof window === 'undefined') return;
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function clearAccessToken() {
  setAccessToken(null);
}

/** Merge into fetch() headers when calling the Express API from plain fetch (upload, etc.). */
export function getAuthHeaderObject() {
  const t = getAccessToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
