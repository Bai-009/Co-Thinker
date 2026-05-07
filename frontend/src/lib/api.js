// Endpoint paths and thin wrappers. All requests go through sessionedFetch
// so X-Session-Id is attached/stored automatically.

import { sessionedFetch } from './session'

export const API = {
  workshop: '/api/chat/workshop',
  judge: '/api/chat/judge',
  history: '/api/chat/history',
  reset: '/api/chat/reset',
  foundation: '/api/chat/foundation',
  brief: '/api/chat/brief',
  sense: '/api/chat/sense',
  clarity: '/api/chat/clarity',
  sessions: '/api/chat/sessions',
  sessionDelete: (id) => `/api/chat/sessions/${encodeURIComponent(id)}`,
}

export async function getJSON(url) {
  const r = await sessionedFetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export function postStream(url, body, { signal } = {}) {
  return sessionedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
    signal,
  })
}
