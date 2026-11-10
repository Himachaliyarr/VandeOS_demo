export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '/api' : 'https://vandeos-demo-1.onrender.com/api');

const accessTokenKey = 'vande_access_token';
let accessToken = typeof window === 'undefined' ? null : window.sessionStorage.getItem(accessTokenKey);

export function setAccessToken(token) {
  accessToken = token;
  if (typeof window === 'undefined') return;
  if (token) window.sessionStorage.setItem(accessTokenKey, token);
  else window.sessionStorage.removeItem(accessTokenKey);
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (accessToken && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
  return payload;
}

export const initials = name => (name || 'V').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
export const formatDate = value => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '—';
export const formatTime = value => value ? new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
export const titleCase = value => (value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
