// One Y.Doc + Hocuspocus provider + IndexedDB binding per pad id.
// Cached outside React so hot-reloads / re-mounts reuse the same live session,
// and so an offline tab keeps editing locally (edits queue and merge on reconnect).

import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${
    (location.hostname || 'localhost') + ':1234'
  }`

// Deploy trap worth shouting about: a production bundle with no VITE_WS_URL
// falls back to wss://<vercel-host>:1234, which will never answer — the pad
// keeps working offline (IndexedDB) so the bug looks like "sync is broken".
if (import.meta.env.PROD && !import.meta.env.VITE_WS_URL) {
  console.warn(
    '⚠️ VITE_WS_URL is not set — this build is talking to %s. Set it to your deployed server (wss://…) or rooms will not sync across devices.',
    WS_URL,
  )
}

// Rewind history lives on the collab port + 1 (ws 1234 → http 1235).
const HISTORY_URL =
  import.meta.env.VITE_HISTORY_URL ||
  WS_URL.replace(/^ws/, 'http').replace(/:1234\b/, ':1235')

const cache = new Map()

// 🔄 Ask OUR server for TURN iceServers (it mints short-lived Xirsys creds
// server-side, so the secret never ships in this public bundle). Returns [] on
// any failure → caller falls back to STUN-only. Cached briefly client-side.
let iceCache = { at: 0, servers: null }
export async function fetchIceServers() {
  if (iceCache.servers && Date.now() - iceCache.at < 60_000) return iceCache.servers
  try {
    const r = await fetch(`${HISTORY_URL}/turn`)
    const data = r.ok ? await r.json() : {}
    iceCache = { at: Date.now(), servers: Array.isArray(data.iceServers) ? data.iceServers : [] }
    return iceCache.servers
  } catch {
    return iceCache.servers || []
  }
}

export function fetchStreak(padId) {
  return fetch(`${HISTORY_URL}/streak/${encodeURIComponent(padId)}`)
    .then((r) => (r.ok ? r.json() : { count: 0 }))
    .catch(() => ({ count: 0 })) // API down → hide the chip gracefully
}

// 💻 Group-code tool: both calls go through OUR server (/code/*) which attaches
// the provider bearer server-side. The browser never sees the cpk_ secret.
async function postJson(path, payload) {
  const r = await fetch(`${HISTORY_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `request failed (${r.status})`)
  return data
}

export const generateProblem = (rawStatement) => postJson('/code/problems', { rawStatement })

export const submitCode = (payload) => postJson('/code/submissions', payload)

export function getPad(padId) {
  if (cache.has(padId)) return cache.get(padId)

  const ydoc = new Y.Doc()
  ydoc.clientID = Math.floor(Math.random() * 0xffffffff)

  // Offline-first: mirror the CRDT to IndexedDB before the socket is even up.
  const local = new IndexeddbPersistence(`syncpad-${padId}`, ydoc)

  const provider = new HocuspocusProvider({
    url: WS_URL,
    name: padId,
    document: ydoc,
    // Queue updates while disconnected, flush + merge on reconnect.
    forceSyncInterval: 30000,
  })

  // Server-side edit log → seed entries for the time-rewind timeline.
  const history = fetch(`${HISTORY_URL}/history/${encodeURIComponent(padId)}`)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []) // history API down / pad unborn → live-only timeline

  // Group streak — consecutive days this pad got edits (server-tracked).
  const streak = fetchStreak(padId)

  const entry = { padId, ydoc, provider, local, wsUrl: WS_URL, history, streak }
  cache.set(padId, entry)
  return entry
}
