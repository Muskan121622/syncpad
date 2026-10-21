// 📌 Sticky wall — post-it notes on a shared board. Each note is an entry in
// a 'stickies' Y.Map (keyed by note id): text, normalized x/y (0..1 so the
// board scales with the resizable frame), color, author. Positions commit to
// the CRDT only on pointer-UP — dragging a note across the board is one op,
// not sixty. Two people rearranging at once never fight: last writer wins
// per note, and different notes merge freely.

import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import SaveButton from './SaveButton.jsx'
import { stickiesText } from '../lib/export.js'

const PAPER = ['#ffe66d', '#ff6ad5', '#4dff9e', '#8b7cff', '#ffb26b', '#33e0ff']
const INK = '#1a1530'

// deterministic tilt per note — same wobble on every screen
const tilt = (id) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0
  return ((h % 7) - 3) * 0.9
}

export default function StickyWall({ stickies, identity }) {
  const [, force] = useState(0)
  const [nextColor, setNextColor] = useState(PAPER[0])
  const boardRef = useRef(null)
  const dragRef = useRef(null) // { id, liveX, liveY } during drag (not in CRDT yet)
  const [dragTick, setDragTick] = useState(0)

  useEffect(() => {
    const obs = () => force((v) => v + 1)
    stickies.observeDeep(obs)
    return () => stickies.unobserveDeep(obs)
  }, [stickies])

  function addNote(cx, cy) {
    const r = boardRef.current.getBoundingClientRect()
    const id = `${identity.id}-${Date.now()}`
    const sm = new Y.Map()
    sm.set('id', id)
    sm.set('text', '')
    sm.set('x', Math.min(0.94, Math.max(0.02, (cx - r.left) / r.width - 0.05)))
    sm.set('y', Math.min(0.9, Math.max(0.02, (cy - r.top) / r.height - 0.06)))
    sm.set('color', nextColor)
    sm.set('by', identity.name)
    sm.set('emoji', identity.emoji)
    sm.set('t', Date.now())
    stickies.set(id, sm)
  }

  function setText(id, text) {
    const sm = stickies.get(id)
    if (sm) sm.set('text', text.slice(0, 220))
  }

  function remove(id) {
    stickies.delete(id)
  }

  // ── drag by the note's head strip ──────────────────────────────────────
  function startDrag(e, sm) {
    e.preventDefault()
    e.stopPropagation()
    const r = boardRef.current.getBoundingClientRect()
    dragRef.current = {
      id: sm.get('id'),
      offX: (e.clientX - r.left) / r.width - sm.get('x'),
      offY: (e.clientY - r.top) / r.height - sm.get('y'),
      liveX: sm.get('x'),
      liveY: sm.get('y'),
    }
    const move = (ev) => {
      const d = dragRef.current
      if (!d) return
      d.liveX = Math.min(0.94, Math.max(0.01, (ev.clientX - r.left) / r.width - d.offX))
      d.liveY = Math.min(0.9, Math.max(0.01, (ev.clientY - r.top) / r.height - d.offY))
      setDragTick((t) => t + 1) // repaint only — CRDT untouched while dragging
    }
    const up = () => {
      const d = dragRef.current
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!d) return
      const target = stickies.get(d.id)
      dragRef.current = null
      if (!target) return
      Y.transact(target.doc, () => {
        // ONE transaction → peers see a single atomic move
        target.set('x', d.liveX)
        target.set('y', d.liveY)
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const notes = [...stickies.values()].sort((a, b) => (a.get('t') || 0) - (b.get('t') || 0))
  void dragTick // live drag positions paint through this dep

  return (
    <div className="sticky-panel">
      <header className="sticky-head">
        <h2>📌 sticky wall</h2>
        <div className="sticky-tools">
          <span className="sticky-count">{notes.length} notes</span>
          <div className="sticky-colors">
            {PAPER.map((p) => (
              <button
                key={p}
                type="button"
                className={`swatch${nextColor === p ? ' is-active' : ''}`}
                style={{ background: p }}
                onClick={() => setNextColor(p)}
                aria-label={`paper ${p}`}
              />
            ))}
          </div>
          <button type="button" className="doodle-btn" onClick={() => {
            const r = boardRef.current.getBoundingClientRect()
            addNote(r.left + r.width / 2, r.top + r.height / 2) // client coords
          }}>
            ➕ note
          </button>
          {notes.length > 0 && (
            <SaveButton
              title="download stickies as .txt"
              make={() => ({ name: 'syncpad-stickies.txt', text: stickiesText(stickies, 'room') })}
            />
          )}
        </div>
      </header>

      <div
        className="sticky-board"
        ref={boardRef}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget || e.target.classList.contains('sticky-board')) {
            addNote(e.clientX, e.clientY)
          }
        }}
      >
        {!notes.length && (
          <div className="sticky-hint">
            double-click anywhere to slap a note 🖐️
            <small>reminders · decisions · vibes — all sync via CRDT</small>
          </div>
        )}
        {notes.map((sm) => {
          const d = dragRef.current
          const dragging = d && d.id === sm.get('id')
          const x = dragging ? d.liveX : sm.get('x')
          const y = dragging ? d.liveY : sm.get('y')
          const id = sm.get('id')
          return (
            <div
              key={id}
              className={`sticky-note${dragging ? ' is-dragging' : ''}`}
              style={{
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                background: sm.get('color'),
                color: INK,
                transform: `rotate(${tilt(id)}deg)`,
              }}
            >
              <div
                className="sticky-grab"
                onPointerDown={(e) => startDrag(e, sm)}
                title={`${sm.get('by')} — drag me`}
              >
                <span>{sm.get('emoji')} {sm.get('by')}</span>
                <button
                  type="button"
                  className="sticky-del"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => remove(id)}
                  aria-label="delete note"
                >
                  ✕
                </button>
              </div>
              <textarea
                className="sticky-text"
                value={sm.get('text') || ''}
                placeholder="type it…"
                maxLength={220}
                onChange={(e) => setText(id, e.target.value)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
