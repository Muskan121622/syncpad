// Vibe picker — changes the theme for EVERYONE in the pad (synced via Y.Map).

import { VIBES } from '../lib/themes.js'

export default function VibePicker({ vibe, onPick }) {
  return (
    <div className="vibes" title="Vibe — synced to everyone in this pad">
      {VIBES.map((v) => (
        <button
          key={v.id}
          type="button"
          className={`vibe-dot${v.id === vibe ? ' is-active' : ''}`}
          style={{ background: v.swatch }}
          title={`${v.label} vibe`}
          onClick={() => onPick(v.id)}
        />
      ))}
    </div>
  )
}
