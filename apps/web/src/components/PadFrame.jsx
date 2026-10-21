// Resizable frame — drag the edges/corner, snap to presets, or go Zen (pad
// only). Size is stored per-BROWSER (localStorage), on purpose: your friend's
// phone should never inherit your ultrawide-monitor layout. Remote cursors
// and doc content stay shared; layout is personal.
// Reused by the doodle board via storeKey/presets/defaultSize props.

import { useEffect, useRef, useState } from 'react'

const MIN_W = 420
const MIN_H = 300
const DEFAULT = { w: 780, h: 0 } // h === 0 → auto-grow height
const STORE_KEY = 'syncpad-pad-size'

const PRESETS = [
  { id: 'S', w: 560 },
  { id: 'M', w: 780 },
  { id: 'L', w: 1040 },
]

function loadSize(storeKey, defaultSize) {
  try {
    const s = JSON.parse(localStorage.getItem(storeKey))
    if (Number.isFinite(s?.w)) return { w: s.w, h: Number.isFinite(s.h) && s.h >= MIN_H ? s.h : 0 }
  } catch {
    /* corrupted → defaults */
  }
  return defaultSize
}

export default function PadFrame({
  zen = false,
  onZenToggle,
  storeKey = STORE_KEY,
  presets = PRESETS,
  defaultSize = DEFAULT,
  extra = null,
  children,
}) {
  const [size, setSize] = useState(() => loadSize(storeKey, defaultSize))
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => {
    localStorage.setItem(storeKey, JSON.stringify(size))
  }, [size, storeKey])

  // Live drag loop — window listeners so fast drags never escape the handle.
  useEffect(() => {
    if (!dragging) return
    const move = (e) => {
      const d = dragRef.current
      if (!d) return
      const maxX = Math.min(window.innerWidth - 48, 1800)
      const maxY = window.innerHeight - 170
      let { w, h } = d
      if (d.mode === 'w' || d.mode === 'wh') {
        w = Math.max(MIN_W, Math.min(maxX, d.w + (e.clientX - d.x)))
      }
      if (d.mode === 'h' || d.mode === 'wh') {
        h = Math.max(MIN_H, Math.min(maxY, d.h0 + (e.clientY - d.y)))
      }
      setSize({ w, h })
    }
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging])

  function beginDrag(mode) {
    return (e) => {
      e.preventDefault()
      const frame = frameRef.current
      if (!frame) return
      const rect = frame.getBoundingClientRect()
      dragRef.current = {
        mode,
        x: e.clientX,
        y: e.clientY,
        w: Math.round(rect.width),
        h: Math.round(rect.width),
        h0: Math.round(rect.height),
      }
      dragRef.current.h = dragRef.current.w // current width, updated per mode
      setDragging(true)
    }
  }

  function applyPreset(w) {
    if (zen && onZenToggle) onZenToggle()
    setSize((s) => ({ ...s, w }))
  }

  const style = zen
    ? { '--pad-w': 'min(1200px, 100%)', '--pad-h': 'calc(100vh - 140px)' }
    : { '--pad-w': `${size.w}px`, '--pad-h': size.h ? `${size.h}px` : 'auto' }

  const activePreset = presets.find((p) => Math.abs(size.w - p.w) < 14)

  return (
    <div
      className={`pad-frame${dragging ? ' is-dragging' : ''}${zen ? ' is-zen' : ''}`}
      style={style}
      ref={frameRef}
    >
      <div className="size-chips">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`size-chip${!zen && activePreset?.id === p.id ? ' is-active' : ''}`}
            title={`${p.id} — ${p.w}px`}
            onClick={() => applyPreset(p.w)}
          >
            {p.id}
          </button>
        ))}
        {onZenToggle && (
          <button
            type="button"
            className={`size-chip zen${zen ? ' is-active' : ''}`}
            title={zen ? 'Exit zen (Esc)' : 'Zen mode — immersive writing'}
            onClick={onZenToggle}
          >
            {zen ? '✕' : '⤢'}
          </button>
        )}
        {extra}
      </div>

      {children}

      {!zen && (
        <>
          <button
            type="button"
            aria-label="Drag to resize width"
            className="rz-handle rz-e"
            title="Drag ↔ width · double-click resets"
            onPointerDown={beginDrag('w')}
            onDoubleClick={() => setSize(DEFAULT)}
          />
          <button
            type="button"
            aria-label="Drag to resize height"
            className="rz-handle rz-s"
            title="Drag ↕ height"
            onPointerDown={beginDrag('h')}
          />
          <button
            type="button"
            aria-label="Drag to resize both"
            className="rz-handle rz-se"
            title="Drag ↘ both"
            onPointerDown={beginDrag('wh')}
            onDoubleClick={() => setSize(DEFAULT)}
          />
        </>
      )}
    </div>
  )
}
