// Floating emoji bursts. Reactions travel as *stateless* websocket messages —
// zero CRDT history pollution, near-zero latency, gone after the animation.

export default function ReactionLayer({ bursts }) {
  return (
    <div className="reaction-layer" aria-hidden="true">
      {bursts.map((b) => (
        <span
          key={b.key}
          className={`burst${b.mine ? ' mine' : ''}`}
          style={{ left: `${b.x}%`, top: `${b.y}%`, '--spin': `${b.spin}deg` }}
        >
          {b.emoji}
        </span>
      ))}
    </div>
  )
}
