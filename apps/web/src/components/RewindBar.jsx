// The rewind deck — scrub slider + timelapse play + "who wrote this step" chips.
// Fully optional: hides itself until the pad has actual edit history.

import { useEffect, useState } from 'react'
import { COLORS } from '../lib/identity.js'

const fmtTime = (t) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function agoLabel(seconds) {
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

// Steps can reference client ids long gone (restored history) — render them
// as deterministic ghosts instead of dropping the attribution.
function authorOf(cid, peers) {
  return (
    peers.find((p) => p.clientId === cid) || {
      clientId: cid,
      name: `ghost-${cid % 100000}`,
      color: COLORS[Math.abs(cid) % COLORS.length],
      emoji: '👻',
    }
  )
}

export default function RewindBar({ timeline, idx, peers, playing, onPlay, onScrub, onLive }) {
  // 1s tick keeps the "Xs ago" label honest while frozen on a step
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (!timeline || timeline.length < 2) return null

  const max = timeline.length - 1
  const rewinding = idx >= 0
  const step = rewinding ? timeline[Math.min(idx, max)] : null
  const ago = step ? Math.max(0, Math.round((Date.now() - step.t) / 1000)) : 0
  const who = step ? step.who.map((cid) => authorOf(cid, peers)) : []

  return (
    <div className={`rewind-bar${rewinding ? ' is-on' : ''}`}>
      <button
        type="button"
        className="rw-btn"
        title={playing ? 'Pause timelapse' : 'Play timelapse ⏵'}
        onClick={onPlay}
      >
        {playing ? '⏸' : '▶'}
      </button>

      <input
        type="range"
        className="rw-slider"
        min={0}
        max={max}
        value={rewinding ? Math.min(idx, max) : max}
        onChange={(e) => onScrub(Number(e.target.value) >= max ? -1 : Number(e.target.value))}
        title={`${max + 1} snapshots this session`}
      />

      <div className="rw-info">
        {rewinding ? (
          <>
            <span className="rw-step">
              step {Math.min(idx, max) + 1}/{timeline.length}
            </span>
            <span className="rw-time">
              👻 {fmtTime(step.t)} · {agoLabel(ago)}
            </span>
            {step.base && (
              <span className="rw-chip ghost-chip">{step.restored ? '⟲ restored history' : 'pad birth'}</span>
            )}
            {who.map((w) => (
              <span key={w.clientId} className="rw-chip" style={{ '--ring': w.color }}>
                {w.emoji || '✍️'} {w.name}
              </span>
            ))}
            <button type="button" className="rw-btn back" onClick={onLive}>
              ⦿ back to live
            </button>
          </>
        ) : (
          <span className="rw-live">● live — drag ◀ to rewind time</span>
        )}
      </div>
    </div>
  )
}
