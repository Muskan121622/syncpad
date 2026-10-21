// Live presence — one glowing chip per human in the room, from Yjs awareness.
// Idle peers (>90s without edits) visibly doze off.

const SLEEP_MS = 90_000

export default function PresenceBar({ peers }) {
  const now = Date.now()
  const sorted = [...peers].sort((a, b) => (a.self ? -1 : b.self ? 1 : 0))
  const shown = sorted.slice(0, 6)
  const extra = sorted.length - shown.length

  return (
    <div className="presence" title={`${peers.length} in this pad`}>
      <div className="presence-stack">
        {shown.map((p) => {
          const sleeping = !p.self && p.lastActive && now - p.lastActive > SLEEP_MS
          return (
            <span
              key={p.id}
              className={`avatar${p.self ? ' is-you' : ''}${sleeping ? ' is-sleepy' : ''}`}
              style={{ '--ring': p.color }}
              title={
                sleeping
                  ? `${p.name} is dozing off 💤`
                  : p.line
                    ? `${p.name}: “${p.line}”`
                    : p.name
              }
            >
              {sleeping ? '😴' : p.mood || p.emoji || '🙂'}
              <b className="avatar-name">
                {p.name}
                {p.self ? ' (you)' : ''}
              </b>
            </span>
          )
        })}
        {extra > 0 && <span className="avatar more">+{extra}</span>}
      </div>
      <span className="presence-count">{peers.length} live</span>
    </div>
  )
}
