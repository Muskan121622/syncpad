// ✅ Room tasks — a shared checklist living in the same Y.Doc as the pad
// (a Y.Array of Y.Maps). Every add/tick/delete is a CRDT op: two people
// editing tasks offline still converge, and "who did what" is recorded
// right on the task. Ticking the LAST task fires a room-wide celebration.

import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import SaveButton from './SaveButton.jsx'
import { tasksText } from '../lib/export.js'

export default function TasksPanel({ tasksArray, identity, onCelebrate }) {
  const [, force] = useState(0)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const obs = () => force((v) => v + 1)
    tasksArray.observeDeep(obs) // deep: changes INSIDE each task map too
    return () => tasksArray.unobserveDeep(obs)
  }, [tasksArray])

  const tasks = []
  tasksArray.forEach((tm) => tasks.push(tm.toJSON()))
  const doneCount = tasks.filter((t) => t.done).length
  const allDone = tasks.length > 0 && doneCount === tasks.length
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0

  function add(e) {
    e.preventDefault()
    const text = draft.trim().slice(0, 100)
    if (!text) return
    const tm = new Y.Map()
    tm.set('id', `${identity.id}-${Date.now()}`)
    tm.set('text', text)
    tm.set('by', identity.name)
    tm.set('emoji', identity.emoji)
    tm.set('done', false)
    tm.set('t', Date.now())
    tasksArray.push([tm])
    setDraft('')
  }

  function toggle(id) {
    for (const tm of tasksArray) {
      if (tm.get('id') !== id) continue
      const wasDone = tm.get('done') === true
      tm.set('done', !wasDone)
      if (!wasDone) {
        tm.set('doneBy', identity.name)
        if (doneCount + 1 === tasks.length) onCelebrate?.() // clean sweep 🧹
      } else {
        tm.delete('doneBy')
      }
      return
    }
  }

  function remove(id) {
    for (let i = 0; i < tasksArray.length; i++) {
      if (tasksArray.get(i).get('id') === id) {
        tasksArray.delete(i, 1)
        return
      }
    }
  }

  return (
    <div className="tasks-panel">
      <header className="tasks-head">
        <h2>✅ room tasks</h2>
        <span className={`tasks-count${allDone ? ' is-all' : ''}`}>
          {tasks.length ? `${doneCount}/${tasks.length} done — ${allDone ? 'sab khatam 🔥' : 'chal raha hai 💪'}` : 'abhi kuch plan nahi kiya'}
        </span>
        {tasks.length > 0 && (
          <SaveButton
            title="download tasks as .txt"
            make={() => ({ name: 'syncpad-tasks.txt', text: tasksText(tasksArray, 'room') })}
          />
        )}
        <div className="tasks-track">
          <i style={{ width: `${pct}%` }} />
        </div>
      </header>

      <ul className="tasks-list">
        {tasks.map((t) => (
          <li key={t.id} className={`task-row${t.done ? ' is-done' : ''}`}>
            <button type="button" className="task-check" onClick={() => toggle(t.id)} aria-label="toggle task">
              {t.done ? '✅' : '⬜'}
            </button>
            <div className="task-body">
              <p>{t.text}</p>
              <small>
                {t.emoji} {t.by} ne maanga
                {t.done && ` · ${t.doneBy} ne kar diya ✔`}
              </small>
            </div>
            <button type="button" className="task-x" onClick={() => remove(t.id)} aria-label="delete task">
              ✕
            </button>
          </li>
        ))}
        {!tasks.length && <li className="tasks-empty">group ka pehla task add karo — "chem DPP solve" jaisa kuch 🗒️</li>}
      </ul>

      <form className="tasks-form" onSubmit={add}>
        <input
          value={draft}
          maxLength={100}
          placeholder="naya task… (enter dabao)"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          add ➕
        </button>
      </form>
    </div>
  )
}
