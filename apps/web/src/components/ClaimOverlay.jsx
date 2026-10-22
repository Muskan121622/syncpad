// Claim-your-identity screen — shown once, before the pad feels live.
// Type a real name (muskan, anu…), pick an emoji + cursor color. This is a
// name *claim*, not an account: no password, no server — the identity rides
// on awareness and labels your cursor for everyone in the room.

import { useState } from 'react'
import { COLORS } from '../lib/identity.js'

const EMOJIS = ['😴', '🔥', '✨', '🫠', '👻', '🐧', '🎧', '💀', '🌙', '⚡', '🦋', '🍄']

export default function ClaimOverlay({ suggestion, onClaim }) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(suggestion?.emoji || '✨')
  const [color, setColor] = useState(suggestion?.color || COLORS[0])

  const clean = name.trim().slice(0, 24)

  function claim() {
    if (!clean) return
    onClaim({ id: suggestion?.id, name: clean, emoji, color })
  }

  return (
    <div className="claim-overlay">
      <div className="claim-card" style={{ '--ring': color }}>
        <div className="claim-preview" style={{ background: color }}>
          {emoji}
        </div>
        <h2>
          {clean ? (
            <>
              yo, <span className="claim-you">{clean}</span> 👋
            </>
          ) : (
            'who&apos;s writing? ✦'
          )}
        </h2>
        <p className="claim-sub">
          This name rides on your cursor — everyone in the pad sees{' '}
          <b>who typed what, live</b>.
        </p>

        <input
          className="claim-input"
          type="text"
          maxLength={24}
          placeholder={suggestion?.claimed === false && suggestion.name ? suggestion.name : 'your name…'}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && claim()}
        />

        <div className="claim-row">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className={`claim-emoji${emoji === e ? ' is-active' : ''}`}
              onClick={() => setEmoji(e)}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="claim-row">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`claim-swatch${color === c ? ' is-active' : ''}`}
              style={{ background: c, ['--sw']: c }}
              onClick={() => setColor(c)}
              aria-label={`cursor color ${c}`}
            />
          ))}
        </div>

        <button type="button" className="claim-btn" disabled={!clean} onClick={claim}>
          claim my name ✦
        </button>
      </div>
    </div>
  )
}
