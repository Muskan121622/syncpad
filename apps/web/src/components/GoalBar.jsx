// 🎯 Pad goal — one shared objective per pad, stored in a 'goal' Y.Map so it
// converges like any other CRDT data. Set it, grind toward it, tick it off
// together (the tick fires a room-wide celebration via onCelebrate).

import { useEffect, useRef, useState } from 'react'

function useMap(map) {
  const [, force] = useState(0)
  useEffect(() => {
    const obs = () => force((v) => v + 1)
    map.observe(obs)
    return () => map.unobserve(obs)
  }, [map])
}

export default function GoalBar({ goalMap, identity, onCelebrate }) {
  useMap(goalMap)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  const goal = goalMap.get('text')
    ? {
        text: goalMap.get('text'),
        by: goalMap.get('by') || '?',
        done: goalMap.get('done') === true,
        doneBy: goalMap.get('doneBy') || null,
      }
    : null

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function submit() {
    const t = draft.trim().slice(0, 80)
    if (!t) return
    goalMap.set('text', t)
    goalMap.set('by', identity.name)
    goalMap.set('done', false)
    goalMap.delete('doneBy')
    setDraft('')
    setEditing(false)
  }

  function toggleDone() {
    const done = goalMap.get('done') === true
    goalMap.set('done', !done)
    if (!done) {
      goalMap.set('doneBy', identity.name)
      onCelebrate?.() // objective cleared — pop off
    } else {
      goalMap.delete('doneBy')
    }
  }

  function clear() {
    ;['text', 'by', 'done', 'doneBy'].forEach((k) => goalMap.delete(k))
    setEditing(false)
  }

  if (!goal) {
    if (!editing) {
      return (
        <button type="button" className="goal-chip" onClick={() => setEditing(true)}>
          <span>🎯</span> pad goal set karo
        </button>
      )
    }
    return (
      <form
        className="goal-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          maxLength={80}
          placeholder="🎯 aaj ka goal… (finish chem notes by 6pm)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        />
        <button type="submit" disabled={!draft.trim()}>
          pin
        </button>
        <button type="button" className="goal-cancel" onClick={() => setEditing(false)}>
          ✕
        </button>
      </form>
    )
  }

  return (
    <div className={`goal-bar${goal.done ? ' is-done' : ''}`} title={`pinned by ${goal.by}`}>
      <button
        type="button"
        className="goal-check"
        onClick={toggleDone}
        title={goal.done ? 'reopen the goal' : 'mark it done — everyone celebrates'}
      >
        {goal.done ? '✅' : '⬜'}
      </button>
      <span className="goal-text">
        🎯 <b>{goal.text}</b>
        <em>
          {goal.done ? `${goal.doneBy} ne kar diya 🎉` : `— ${goal.by} pinned`}
        </em>
      </span>
      <button type="button" className="goal-x" onClick={clear} title="clear the goal">
        ✕
      </button>
    </div>
  )
}
