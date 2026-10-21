// Focus Room — a CRDT-synced group pomodoro. Anyone can start it; the
// server owns phase flips (focus→break→focus, auto-cycling); every client
// renders the same countdown locally from `endsAt`. Chime on transitions is
// WebAudio-synthesized — zero assets, zero fetches.

import { useEffect, useRef, useState } from 'react'

const PRESETS = [15, 25, 50] // minutes of deep work

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// little three-note bell; rises to start focus, falls for break
function chime(toFocus) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    const notes = toFocus ? [523.25, 659.25, 783.99] : [783.99, 659.25, 523.25]
    notes.forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      o.connect(g)
      g.connect(ctx.destination)
      const t = ctx.currentTime + i * 0.12
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.03)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o.start(t)
      o.stop(t + 0.55)
    })
    setTimeout(() => ctx.close(), 1600)
  } catch {
    /* autoplay policy blocked it — no big deal */
  }
}

export default function FocusBar({ focusMap, identity, peers, onPhase }) {
  const [, force] = useState(0)
  const [now, setNow] = useState(Date.now())
  const lastFlip = useRef(focusMap.get('flipAt') || 0)

  useEffect(() => {
    const obs = () => force((n) => n + 1)
    focusMap.observeDeep(obs)
    return () => focusMap.unobserveDeep(obs)
  }, [focusMap])

  const phase = focusMap.get('phase')
  const active = phase === 'focus' || phase === 'break'

  // local 500ms clock while a session runs — countdown without CRDT writes
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [active])

  // chime + notify App on any transition (including our optimistic start)
  const flipAt = focusMap.get('flipAt') || 0
  useEffect(() => {
    if (flipAt && flipAt !== lastFlip.current) {
      lastFlip.current = flipAt
      chime(phase === 'focus')
      onPhase?.(phase)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipAt])

  function start(mins) {
    const secs = mins * 60
    focusMap.set('phase', 'focus')
    focusMap.set('secs', secs)
    focusMap.set('endsAt', Date.now() + secs * 1000)
    focusMap.set('by', identity.name)
    focusMap.set('flipAt', Date.now())
  }

  function stop() {
    focusMap.set('phase', 'idle')
    focusMap.set('flipAt', Date.now())
  }

  if (!active) {
    return (
      <div className="focus-bar is-idle">
        <span className="focus-title">🍅 focus room</span>
        {PRESETS.map((m) => (
          <button key={m} type="button" className="focus-preset" onClick={() => start(m)}>
            {m}m
          </button>
        ))}
        <span className="focus-hint">start it once — the whole room syncs to one clock</span>
      </div>
    )
  }

  const endsAt = Number(focusMap.get('endsAt')) || 0
  const total = Number(focusMap.get('secs')) || 1500
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000))
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100))

  return (
    <div className={`focus-bar is-${phase}`}>
      <span className="focus-emoji">{phase === 'focus' ? '📚' : '☕'}</span>
      <span className="focus-time">{fmt(remaining)}</span>
      <span className="focus-what">{phase === 'focus' ? 'deep work' : 'break — stretch!'}</span>
      <div className="focus-track">
        <div className="focus-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="focus-by">by {focusMap.get('by') || 'someone'}</span>
      <span className="focus-crew">{peers.length} in the room</span>
      <button type="button" className="focus-stop" onClick={stop} title="End session">
        ✕
      </button>
    </div>
  )
}
