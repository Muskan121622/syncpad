// Time-rewind recorder — turns the live Y.Doc into a scrubbable edit timeline.
//
// How attribution works: every structural change (including deletions, which
// create tombstones) advances the writing client's clock in the doc's state
// vector. By diffing the vector on each update we learn EXACTLY which client
// ids wrote each interval — no server cooperation needed. Snapshots of the
// full encoded state are debounced so scrubbing stays cheap.
//
// Note: the live timeline is an in-memory ring buffer, but each step is also
// logged server-side as an NDJSON delta — `buildTimelineFromRecords` replays
// that log so the movie survives reloads and server restarts.

import * as Y from 'yjs'

const LIMIT = 180 // snapshots kept (~3 min of active editing at 1s debounce)
const DEBOUNCE_MS = 1200

// Replay the server's delta log into seed timeline entries. Applying update
// prefixes in causal order reconstructs the exact document state at each step.
export function buildTimelineFromRecords(records, limit = LIMIT) {
  if (!records?.length) return []
  const scratch = new Y.Doc()
  const steps = [
    {
      seq: 0,
      t: records[0].t,
      doc: Y.encodeStateAsUpdate(scratch),
      who: [],
      base: true,
      restored: true,
    },
  ]
  records.forEach((r, i) => {
    try {
      Y.applyUpdate(scratch, base64ToBytes(r.u))
      steps.push({ seq: i + 1, t: r.t, doc: Y.encodeStateAsUpdate(scratch), who: r.who ?? [], restored: true })
    } catch {
      /* skip corrupt record */
    }
  })
  scratch.destroy()
  return steps.slice(-limit)
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// Y.encodeStateVector returns ENCODED bytes — decode them into the
// clientID → clock Map we diff against.
const vectorMap = (doc) => Y.decodeStateVector(Y.encodeStateVector(doc))

export function createRecorder(ydoc, { limit = LIMIT, debounce = DEBOUNCE_MS, onEvent = () => {}, seed = [] } = {}) {
  const timeline = seed.length
    ? [...seed]
    : [{ seq: 0, t: Date.now(), doc: Y.encodeStateAsUpdate(ydoc), who: [], base: true }]
  let lastVector = vectorMap(ydoc)
  let pending = new Set()
  let timer = null
  let seq = timeline[timeline.length - 1].seq + 1

  function flush() {
    timer = null
    if (!pending.size) return
    const entry = {
      seq: seq++,
      t: Date.now(),
      doc: Y.encodeStateAsUpdate(ydoc),
      who: [...pending],
    }
    pending.clear()
    timeline.push(entry)
    // keep the base snapshot at index 0, drop the oldest middle entries
    while (timeline.length > limit) timeline.splice(1, 1)
    onEvent(entry)
  }

  function onUpdate() {
    const vec = vectorMap(ydoc)
    let changed = false
    vec.forEach((clock, client) => {
      if (clock > (lastVector.get(client) || 0)) {
        pending.add(client)
        changed = true
      }
    })
    lastVector = vec
    if (!changed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, debounce)
  }

  ydoc.on('update', onUpdate)

  return {
    timeline,
    destroy() {
      if (timer) clearTimeout(timer)
      ydoc.off('update', onUpdate)
    },
  }
}
