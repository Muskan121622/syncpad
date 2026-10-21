// 🗝 Room routing — one source of truth for "where am I".
//
// Shape:  /r/<roomKey>[/<tool>]     e.g. /r/k7m2xq9p4tgb/sheet
// Legacy: ?p=<roomKey>&t=<tool>    (old links keep working, then get
//        canonicalised to the pretty path on first paint)
//
// No room key in the URL → a fresh random one is minted. That is the whole
// fix for the "everyone lands in the same pad" bug: a shared default name
// means 100 strangers editing one document. Google does 43-char ids for
// exactly this reason; 12 chars from a 31-symbol alphabet is ~7.6e17 rooms,
// which is plenty for a study app.

const KEY_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789' // no 0/o/1/i/l lookalikes
const KEY_LEN = 12

/** Cryptographic random room key, e.g. 'k7m2xq9p4tgb'. */
export function newRoomKey(len = KEY_LEN) {
  const bytes = new Uint8Array(len)
  const c = globalThis.crypto
  if (c?.getRandomValues) c.getRandomValues(bytes)
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = ''
  for (let i = 0; i < len; i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length]
  return out
}

/** Room keys are also CRDT document names and filesystem names — keep them tame. */
export function sanitizeKey(raw) {
  const clean = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return clean.slice(0, 48)
}

/** Everything before /r/ — so the app also works under a mounted sub-path. */
function basePath(pathname) {
  const i = pathname.indexOf('/r/')
  if (i === 0) return '/'
  if (i > 0) return pathname.slice(0, i) + '/'
  return '/'
}

/**
 * Read the current location. `tool` is the RAW segment/query value — the
 * caller validates it against the tool registry (this module stays
 * dependency-free so it can be imported anywhere, including tests).
 */
export function readRoute(loc = location) {
  const segs = loc.pathname.split('/').filter(Boolean)
  const ri = segs.indexOf('r')
  let padId = null
  let tool = null
  if (ri >= 0 && segs[ri + 1]) {
    padId = sanitizeKey(segs[ri + 1])
    if (segs[ri + 2]) tool = segs[ri + 2].toLowerCase()
  }
  const q = new URLSearchParams(loc.search)
  if (!padId && q.get('p')) padId = sanitizeKey(q.get('p'))
  if (!tool && q.get('t')) tool = q.get('t').toLowerCase()
  return { padId: padId || null, tool }
}

/** Pretty URL for a room (+ optional tool). Absolute, ready to share. */
export function routeUrl(padId, tool = null, loc = location) {
  const base = basePath(loc.pathname)
  const path = `${base}r/${sanitizeKey(padId)}${tool && tool !== 'pad' ? `/${tool}` : ''}`
  return `${loc.origin}${path}`
}

/** Host + path only — for printing on the recap card, not for clicking. */
export function routeLabel(padId, tool = null, loc = location) {
  return routeUrl(padId, tool, loc).replace(/^https?:\/\//, '')
}

/**
 * Keep the address bar in sync without touching the back button.
 * NOTE: call sites often have a local `history` binding (the rewind promise),
 * so this reaches for window.history explicitly — always.
 */
export function writeRoute(padId, tool = null, loc = location) {
  const url = new URL(routeUrl(padId, tool, loc))
  window.history.replaceState(null, '', url)
  return url.pathname
}
