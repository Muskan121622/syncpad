// SyncPad collaboration server — Hocuspocus + Yjs, disk-persisted, Redis-ready.
import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs'
import { writeFile, appendFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Y from 'yjs'
import { Server } from '@hocuspocus/server'
import { Redis } from '@hocuspocus/extension-redis'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(HERE, '..', 'data')
const HISTORY_DIR = join(DATA_DIR, 'history')
mkdirSync(HISTORY_DIR, { recursive: true })

const PORT = Number(process.env.PORT) || 1234
const HISTORY_PORT = Number(process.env.HISTORY_PORT) || PORT + 1

// PaaS reality: Fly.io / Railway / Render give you EXACTLY ONE port.
// SINGLE_PORT=1 bolts the rewind/streak REST API onto Hocuspocus' own HTTP
// server instead of opening a second listener. Websocket upgrades ride on the
// 'upgrade' event, which we never touch — so ws + REST share one socket.
const SINGLE_PORT = ['1', 'true'].includes(String(process.env.SINGLE_PORT ?? ''))

// ── Redis fan-out (optional — enables multi-node horizontal scaling) ──────
const extensions = []
if (process.env.REDIS_URL) {
  const url = new URL(process.env.REDIS_URL)
  extensions.push(
    new Redis({
      host: url.hostname,
      port: Number(url.port || 6379),
      prefix: 'syncpad',
    }),
  )
  console.log('🔴 Redis pub/sub fan-out enabled')
} else {
  console.log('⚪️  No REDIS_URL — single-node mode (set REDIS_URL to scale out)')
}

// ── Snapshot persistence: debounced CRDT state → disk ──────────────────────
const safeName = (n) => n.replace(/[^a-z0-9_-]/gi, '_')
const pathFor = (documentName) => join(DATA_DIR, `${safeName(documentName)}.ydoc`)

const saveTimers = new Map()
const pendingStates = new Map()

async function flush(documentName) {
  const state = pendingStates.get(documentName)
  if (!state) return
  pendingStates.delete(documentName)
  saveTimers.delete(documentName)
  try {
    await writeFile(pathFor(documentName), Buffer.from(state))
    console.log(`💾 persisted "${documentName}" (${state.byteLength}B)`)
  } catch (err) {
    console.error(`💥 failed persisting "${documentName}":`, err.message)
  }
}

// ── Edit log (time-rewind history): NDJSON delta stream per pad ────────────
// Every structural change advances the writing client's clock in the doc's
// state vector — diffing the vector per update tells us WHO wrote each
// interval. Raw updates are merged per debounce window and appended as one
// line: { t, who:[clientIds], u:base64(delta) }. Clients replay prefixes to
// rebuild any past state — the movie survives reloads and server restarts.

const HISTORY_DEBOUNCE_MS = 1_200
const HISTORY_MAX_BYTES = 8 * 1024 * 1024 // 8MB per pad, then pause recording
const HISTORY_LIMIT = 400 // records served per fetch

const historyPathFor = (documentName) => join(HISTORY_DIR, `${safeName(documentName)}.ndjson`)
const capWarned = new Set()

// Y.encodeStateVector returns encoded bytes — decode to the clientID→clock Map.
const vectorMap = (doc) => Y.decodeStateVector(Y.encodeStateVector(doc))

function flushEditLog(documentName, rec) {
  rec.timer = null
  if (!rec.updates.length) return
  const merged = Y.mergeUpdates(rec.updates)
  const who = [...rec.clients]
  rec.updates = []
  rec.clients.clear()

  const file = historyPathFor(documentName)
  if (capWarned.has(documentName)) return
  try {
    if (existsSync(file) && statSync(file).size > HISTORY_MAX_BYTES) {
      capWarned.add(documentName)
      console.log(`📚 "${documentName}" hit the history cap — rewind recording paused`)
      return
    }
    const line = `${JSON.stringify({ t: Date.now(), who, u: Buffer.from(merged).toString('base64') })}\n`
    appendFile(file, line).catch((err) => console.error('edit-log append failed:', err.message))
  } catch (err) {
    console.error('edit-log flush failed:', err.message)
  }
}

function attachEditLogger(documentName, document) {
  // First-ever record must be the FULL current state — later lines are deltas,
  // and clients replay prefixes of this stream. Without a base snapshot the
  // replay would silently miss anything written before logging began.
  const file = historyPathFor(documentName)
  if (!existsSync(file) || statSync(file).size === 0) {
    const base = { t: Date.now(), who: [], u: Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64') }
    appendFile(file, `${JSON.stringify(base)}\n`).catch((err) =>
      console.error('edit-log base failed:', err.message),
    )
  }

  const rec = {
    lastVector: vectorMap(document),
    updates: [],
    clients: new Set(),
    timer: null,
  }
  document.on('update', (update) => {
    const vec = vectorMap(document)
    vec.forEach((clock, client) => {
      if (clock > (rec.lastVector.get(client) ?? 0)) rec.clients.add(client)
    })
    rec.lastVector = vec
    rec.updates.push(update)
    if (!rec.timer) rec.timer = setTimeout(() => flushEditLog(documentName, rec), HISTORY_DEBOUNCE_MS)
  })
}

// ── Focus Room: server-owned pomodoro transitions ──────────────────────────
// The 'focus' Y.Map is shared CRDT state: { phase, secs, endsAt, by, flipAt }.
// Clients render the countdown locally from endsAt (zero network chatter);
// ONLY this driver flips focus→break→focus, so every client sees the exact
// same transition with no write races. Everyone leaving unloads the pad and
// pauses the session; a stale timer resets to idle on next load.

const FOCUS_BREAK_SECS = 5 * 60
const FOCUS_STALE_MS = 10 * 60 * 1000
const focusDrivers = new Map()

function stopFocusDriver(documentName) {
  const id = focusDrivers.get(documentName)
  if (id) {
    clearInterval(id)
    focusDrivers.delete(documentName)
  }
}

function ensureFocusDriver(documentName, document) {
  const focus = document.getMap('focus')
  const phase = focus.get('phase')
  const endsAt = Number(focus.get('endsAt')) || 0

  if (phase !== 'focus' && phase !== 'break') return stopFocusDriver(documentName)
  if (Date.now() - endsAt > FOCUS_STALE_MS) {
    // session died with an empty room — reset instead of auto-resurrecting
    focus.set('phase', 'idle')
    return stopFocusDriver(documentName)
  }
  if (focusDrivers.has(documentName)) return

  const id = setInterval(() => {
    const current = focus.get('phase')
    if (current !== 'focus' && current !== 'break') return stopFocusDriver(documentName)
    if (Date.now() < (Number(focus.get('endsAt')) || 0)) return

    const next = current === 'focus' ? 'break' : 'focus'
    const secs = next === 'break' ? FOCUS_BREAK_SECS : Number(focus.get('secs')) || 25 * 60
    focus.set('phase', next)
    focus.set('secs', secs)
    focus.set('endsAt', Date.now() + secs * 1000)
    focus.set('flipAt', Date.now())
    console.log(`🍅 "${documentName}" → ${next} (${Math.round(secs / 60)}m)`)
  }, 1000)
  focusDrivers.set(documentName, id)
}

// ── Pad streaks: consecutive days someone touched the pad ──────────────────
// One group counter per pad — guilt-driven retention, BeReal style. Stored
// as a tiny JSON map { pad: { last:'YYYY-MM-DD', count } }; bumped on every
// update batch (O(1) same-day early-return) and debounced to disk.

const STREAK_FILE = join(DATA_DIR, 'streaks.json')
let streaks = {}
try {
  streaks = JSON.parse(readFileSync(STREAK_FILE, 'utf8'))
} catch {
  /* first boot — empty map */
}

const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const yesterdayKey = () => dayKey(new Date(Date.now() - 86_400_000))

let streakSaveTimer = null
function persistStreaks() {
  if (streakSaveTimer) return
  streakSaveTimer = setTimeout(() => {
    streakSaveTimer = null
    writeFile(STREAK_FILE, JSON.stringify(streaks, null, 2)).catch((err) =>
      console.error('streak save failed:', err.message),
    )
  }, 3000)
}

function bumpStreak(documentName) {
  const today = dayKey()
  const s = streaks[documentName] || { last: null, count: 0 }
  if (s.last === today) return // already counted today
  s.count = s.last === yesterdayKey() ? s.count + 1 : 1
  s.last = today
  streaks[documentName] = s
  persistStreaks()
  console.log(`⚡ "${documentName}" streak → ${s.count} day(s)`)
}

// ── TURN credential minting: GET /turn → { iceServers, ttl } ─────────────
// Cross-city WebRTC needs a TURN relay, and providers (Xirsys et al.) hand out
// SHORT-LIVED iceServers from an ident:secret that MUST stay server-side — the
// frontend is public, so baking the secret there would let anyone burn our
// quota. Instead the browser asks US for /turn, we POST to the provider with
// the secret, cache until near expiry, and return only the public iceServers.
//
// Env (set on Render): XIRSYS_PATH, XIRSYS_IDENT, XIRSYS_SECRET, XIRSYS_CHANNEL.
// Unset → /turn returns an empty iceServers list and the app falls back to
// STUN-only (LAN / direct-P2P still work, hard-NAT peers won't).
const turnCache = { body: null, expiresAt: 0 }

async function mintTurn() {
  const { XIRSYS_PATH, XIRSYS_IDENT, XIRSYS_SECRET, XIRSYS_CHANNEL } = process.env
  if (!XIRSYS_PATH || !XIRSYS_IDENT || !XIRSYS_SECRET) return null
  const base = XIRSYS_PATH.replace(/\/+$/, '')
  const path = XIRSYS_CHANNEL ? `/_turn/${encodeURIComponent(XIRSYS_CHANNEL)}` : '/_turn'
  // Xirsys wants HTTP Basic (base64 ident:secret), a PUT, and ?webrtc=1 so it
  // returns a standard iceServers array. expire = credential auth lifetime,
  // capped at 6h; we ask for the max so long calls + re-offers still allocate.
  const auth = Buffer.from(`${XIRSYS_IDENT}:${XIRSYS_SECRET}`).toString('base64')
  const res = await fetch(`${base}${path}?webrtc=1&expire=21600`, {
    method: 'PUT',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.s !== 'ok') throw new Error(`provider responded ${res.status}`)
  const ttl = 21_600
  return { body: JSON.stringify({ iceServers: data.v?.iceServers || [], ttl }), ttl }
}

// Async so it never blocks apiHandler's sync true/false contract. It OWNS the
// response the moment it's called, so apiHandler returns true immediately.
async function handleTurn(res) {
  res.setHeader('access-control-allow-origin', '*')
  const now = Date.now()
  // refresh once within an hour of expiry (or on first hit / after a failure)
  if (!turnCache.body || now > turnCache.expiresAt - 3_600_000) {
    try {
      const minted = await mintTurn()
      if (minted) {
        turnCache.body = minted.body
        turnCache.expiresAt = now + minted.ttl * 1000
        console.log('🔄 minted TURN credentials')
      }
    } catch (err) {
      console.error('⚠️  TURN mint failed:', err.message)
    }
  }
  if (turnCache.body) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(turnCache.body)
  } else {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ iceServers: [], error: 'turn provider not configured' }))
  }
}

// ── Group-code judge proxy: POST /code/problems · /code/submissions ───────
// Same trust boundary as /turn: the codeprep provider key (cpk_…) is a SECRET
// and the frontend is public, so the browser can NEVER call the judge API
// directly. It calls US; we attach the bearer and forward. We pass the
// provider's verdict JSON straight back so the client sees the real shape.
//
// Env (set on Render): CODEPREP_API (…/api/v1 base), CODEPREP_API_KEY (cpk_…).
// Unset → 503 and the tool shows "judge not configured" (rest of app fine).
function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > limit) {
        reject(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

async function handleCode(req, res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  const { CODEPREP_API, CODEPREP_API_KEY } = process.env
  if (!CODEPREP_API || !CODEPREP_API_KEY) {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'code judge not configured on server' }))
    return
  }
  const kind = /^\/code\/(problems|submissions)$/.exec(req.url || '')?.[1]
  const upstream = kind === 'problems' ? '/problems/generate' : '/submissions'
  let body
  try {
    body = await readJsonBody(req)
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: err.message }))
    return
  }
  // Whitelist only the fields the provider needs — never echo/leak anything else.
  const payload =
    kind === 'problems'
      ? { rawStatement: String(body.rawStatement || '').slice(0, 20000) }
      : {
          problemId: body.problemId,
          language: String(body.language || 'python3').slice(0, 32),
          sourceCode: String(body.sourceCode || '').slice(0, 100000),
          mode: body.mode === 'run' ? 'run' : 'submit',
          style: String(body.style || 'stdin').slice(0, 16),
        }
  try {
    const base = CODEPREP_API.replace(/\/+$/, '')
    const r = await fetch(`${base}${upstream}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${CODEPREP_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const text = await r.text()
    res.writeHead(r.status, { 'content-type': 'application/json' })
    res.end(text) // verbatim verdict passthrough
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: `judge upstream failed: ${err.message}` }))
  }
}

// ── History API: GET /history/<pad> → [{ t, who, u(base64) }, …] ──────────
// Returns true when WE answered the request, false when the path isn't ours —
// so the same function can run on its own port (dev) or layered onto
// Hocuspocus' server (single-port deploys).
function apiHandler(req, res) {
  res.setHeader('access-control-allow-origin', '*')

  // GET /turn → freshly minted iceServers (async, owns its response)
  if (/^\/turn\b/.test(req.url || '')) {
    handleTurn(res)
    return true
  }

  // POST /code/problems · /code/submissions → judge proxy (async, owns response)
  if (/^\/code\/(problems|submissions)$/.test(req.url || '')) {
    handleCode(req, res)
    return true
  }

  // GET /streak/<pad> → { last, count }
  const streakMatch = /^\/streak\/([A-Za-z0-9_-]{1,64})$/.exec(req.url || '')
  if (streakMatch) {
    const s = streaks[streakMatch[1]] || { last: null, count: 0 }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(s))
    return true
  }

  const match = /^\/history\/([A-Za-z0-9_-]{1,64})$/.exec(req.url || '')
  if (!match) {
    if (req.url === '/health') {
      // uptime probe — free observability on any PaaS health check
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          pads: server?.getDocumentsCount?.() ?? 0,
          uptime: Math.round(process.uptime()),
        }),
      )
      return true
    }
    return false
  }
  const file = historyPathFor(match[1])
  if (!existsSync(file)) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('[]')
    return true
  }
  try {
    const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(-HISTORY_LIMIT)
    const records = lines.map((l) => JSON.parse(l))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(records))
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: err.message }))
  }
  return true
}

const historyServer = createServer((req, res) => {
  if (apiHandler(req, res)) return
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{"error":"unknown route"}')
})

const server = Server.configure({
  name: 'syncpad',
  port: PORT,
  timeout: 30_000,
  debounce: 1_500,
  extensions,

  async onLoadDocument({ documentName, document }) {
    const file = pathFor(documentName)
    if (existsSync(file)) {
      Y.applyUpdate(document, new Uint8Array(readFileSync(file)))
      console.log(`⚡ restored "${documentName}" from disk`)
    }
    // attach AFTER the disk restore so bootstrapping isn't logged as edits
    attachEditLogger(documentName, document)
    ensureFocusDriver(documentName, document)
    return document
  },

  // Hocuspocus hands us the full encoded state on every update batch.
  async onUpdate({ documentName, state }) {
    bumpStreak(documentName)
    pendingStates.set(documentName, state)
    if (!saveTimers.has(documentName)) {
      saveTimers.set(
        documentName,
        setTimeout(() => flush(documentName), 1_500),
      )
    }
  },

  async afterUnloadDocument({ documentName }) {
    stopFocusDriver(documentName)
    await flush(documentName)
  },

  // Stateless messages (reaction bursts, pings) are broadcast to the room
  // by Hocuspocus itself — we just keep the hook for logging/limits.
  async onStateless({ documentName, payload }) {
    try {
      const msg = JSON.parse(payload)
      if (msg.t !== 'r') return // only react-packets for now
    } catch {
      /* ignore malformed payloads */
    }
  },

  // NOTE: deliberately NO onAuthenticate hook here. Defining it flips
  // Hocuspocus into requiresAuthentication mode, and a client without a
  // token then deadlocks (messages queued → 4401 close → no retry).
  // v0 rooms are open; when auth lands, add the hook AND provider token
  // together.
})

// Graceful shutdown: flush everything before exit.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`\n${sig} — flushing ${saveTimers.size} pending pad(s)…`)
    await Promise.all([...saveTimers.keys()].map((n) => flush(n)))
    await server.destroyInstance()
    process.exit(0)
  })
}

server.listen().then(() => {
  console.log(`\n✦ SyncPad server listening on ws://localhost:${PORT}`)
  console.log(`  data dir: ${DATA_DIR}`)

  if (SINGLE_PORT) {
    // Hocuspocus owns the only listener. Take it over cleanly: remember its own
    // request handler, answer our routes first, delegate everything else to it
    // (keeps the onRequest hook chain and the default "OK" page working).
    const http = server.server?.httpServer
    if (!http) {
      console.error('⚠️  SINGLE_PORT set but no http server found — history API is offline')
      return
    }
    const internal = http.listeners('request').slice()
    http.removeAllListeners('request')
    http.on('request', (req, res) => {
      if (apiHandler(req, res)) return
      internal.forEach((fn) => fn.call(http, req, res))
    })
    console.log('📚 rewind history API on the SAME port — /history/<pad>, /streak/<pad>, /health')
  } else {
    historyServer.listen(HISTORY_PORT, () => {
      console.log(`📚 rewind history API on http://localhost:${HISTORY_PORT}/history/<pad>`)
    })
  }
})
