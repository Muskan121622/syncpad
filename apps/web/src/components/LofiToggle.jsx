// 🎧 Lo-fi room toggle — the on/off state lives in the shared 'meta' Y.Map,
// so one person dropping the beat puts the whole room in cozy mode. Browsers
// block autoplay without a gesture, so a remote toggle that can't start audio
// yet quietly retries on the user's next click.

import { useEffect, useRef, useState } from 'react'
import { createLofi } from '../lib/lofi.js'

export default function LofiToggle({ meta }) {
  const [on, setOn] = useState(() => meta.get('lofi') === true)
  const [blocked, setBlocked] = useState(false) // wants sound, awaiting gesture
  const engineRef = useRef(null)

  useEffect(() => {
    const engine = createLofi()
    engineRef.current = engine

    const apply = (want) => {
      setOn(want)
      if (want) {
        engine.start().then(() => setBlocked(false)).catch(() => setBlocked(true))
      } else {
        setBlocked(false)
        engine.stop()
      }
    }

    const observer = (event) => {
      // local AND remote writes both apply — room-wide ambience is the point
      if (event.key === 'lofi') apply(meta.get('lofi') === true)
    }
    meta.observe(observer)
    apply(meta.get('lofi') === true) // adopt whatever the room left on

    // gesture-unlock: if autoplay was blocked, retry on next pointerdown
    const unlock = () => {
      if (meta.get('lofi') === true && !engine.isRunning()) {
        engine.start().then(() => setBlocked(false)).catch(() => {})
      }
    }
    window.addEventListener('pointerdown', unlock)

    return () => {
      meta.unobserve(observer)
      window.removeEventListener('pointerdown', unlock)
      engine.destroy()
    }
  }, [meta])

  function toggle() {
    // single CRDT write; local observer fires → both peers converge
    meta.set('lofi', !(meta.get('lofi') === true))
  }

  return (
    <button
      type="button"
      className={`lofi-toggle${on ? ' is-on' : ''}`}
      onClick={toggle}
      title={on ? 'lo-fi on — room-synced ambience (synthesized, no files)' : 'turn on ambient lo-fi for everyone'}
    >
      <span className="lofi-icon">{on ? (blocked ? '🔇' : '🎧') : '🌫'}</span>
      <span>{on ? (blocked ? 'tap for sound' : 'lo-fi — sabke liye') : 'lo-fi room'}</span>
      {on && (
        <span className="lofi-bars" aria-hidden>
          <i /><i /><i /><i />
        </span>
      )}
    </button>
  )
}
