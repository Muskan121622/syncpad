// ◀ Tool rail — the left vertical switcher that turns SyncPad from "a pad"
// into a room workspace. Pad stays mounted underneath; the rail just swaps
// what's visible on top. Tools marked 🔜 are the next drops in the queue.

export const TOOLS = [
  { id: 'pad', icon: '📝', label: 'type pad' },
  { id: 'tasks', icon: '✅', label: 'room tasks' },
  { id: 'doodle', icon: '🎨', label: 'doodle board' },
  { id: 'sticky', icon: '📌', label: 'sticky wall' },
  { id: 'sheet', icon: '🧮', label: 'the sheet' },
  { id: 'code', icon: '💻', label: 'group code' },
  { id: 'viewer', icon: '📽', label: 'shared viewer' },
]

export default function ToolRail({ tool, onTool, onRecap, callActive = false, onToggleCall }) {
  return (
    <nav className="tool-rail" aria-label="room tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`rail-btn${tool === t.id ? ' is-active' : ''}${t.soon ? ' is-soon' : ''}`}
          data-label={t.label}
          onClick={() => !t.soon && onTool(t.id)}
          aria-label={t.label}
          aria-pressed={tool === t.id}
        >
          {t.icon}
        </button>
      ))}

      <span className="rail-div" aria-hidden />

      <button
        type="button"
        className={`rail-btn${callActive ? ' is-active is-call' : ''}`}
        data-label={callActive ? 'leave call 🎥' : 'study call 🎥'}
        onClick={onToggleCall}
        aria-label="join or leave the study call"
        aria-pressed={callActive}
      >
        🎥
      </button>

      <button
        type="button"
        className="rail-btn"
        data-label="session recap 📊"
        onClick={onRecap}
        aria-label="open session recap"
      >
        📊
      </button>
    </nav>
  )
}
