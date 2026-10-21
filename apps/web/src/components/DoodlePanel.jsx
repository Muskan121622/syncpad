// 🎨 Doodle board — collaborative freehand canvas. Every finished stroke is
// pushed as a Y.Map into a shared 'doodles' Y.Array (same Y.Doc as the pad):
// strokes from offline/parallel drawers all survive and merge in causal
// order — no locks, no "anu is drawing so you can't". Points are stored
// NORMALIZED (0..1) so the art is resolution-independent and looks the same
// on every screen size. While your pen is down the stroke lives in a ref and
// is painted as a live overlay — the CRDT only sees it on pointer-up, so a
// 200ms doodle = ONE op on the wire, not 200.

import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import SaveButton from './SaveButton.jsx'

const BG = '#12162c'
const PALETTE = ['#ff6b81', '#ffb26b', '#ffe66d', '#4dff9e', '#33e0ff', '#8b7cff', '#ff6ad5', '#ffffff']
const SIZES = [3, 7, 14]

export default function DoodlePanel({ doodles, identity }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const liveRef = useRef(null) // in-progress stroke (not yet CRDT-committed)
  const rafRef = useRef(0)
  const [, force] = useState(0)

  const [color, setColor] = useState(PALETTE[5])
  const [size, setSize] = useState(7)
  const [eraser, setEraser] = useState(false)

  useEffect(() => {
    const obs = () => force((v) => v + 1)
    doodles.observeDeep(obs)
    return () => doodles.unobserveDeep(obs)
  }, [doodles])

  // repaint (rAF-throttled) on every render + on container resize
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(paint)
  })
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(paint)
    })
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  function paint() {
    const c = canvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const { clientWidth: w, clientHeight: h } = c
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr
      c.height = h * dpr
    }
    const ctx = c.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, w, h)
    const scale = w / 1000 // stroke px sizes are authored against 1000px wide
    doodles.forEach((s) => paintStroke(ctx, s.toJSON(), w, h, scale))
    if (liveRef.current) paintStroke(ctx, liveRef.current, w, h, scale)
  }

  function paintStroke(ctx, s, w, h, scale) {
    const pts = s.pts
    ctx.strokeStyle = ctx.fillStyle = s.color
    ctx.lineWidth = Math.max(1, s.size * scale)
    ctx.lineCap = ctx.lineJoin = 'round'
    if (pts.length === 1) {
      ctx.beginPath()
      ctx.arc(pts[0][0] * w, pts[0][1] * h, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    ctx.beginPath()
    ctx.moveTo(pts[0][0] * w, pts[0][1] * h)
    // quadratic midpoint smoothing — polyline → marker flow
    for (let i = 1; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[i + 1]
      ctx.quadraticCurveTo(x1 * w, y1 * h, ((x1 + x2) / 2) * w, ((y1 + y2) / 2) * h)
    }
    const [lx, ly] = pts[pts.length - 1]
    ctx.lineTo(lx * w, ly * h)
    ctx.stroke()
  }

  // ── pointer → stroke plumbing ─────────────────────────────────────────
  function toPt(e) {
    const r = canvasRef.current.getBoundingClientRect()
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ]
  }

  function down(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    liveRef.current = {
      pts: [toPt(e)],
      color: eraser ? BG : color,
      size: eraser ? size * 3.2 : size,
    }
  }

  function move(e) {
    const live = liveRef.current
    if (!live) return
    const p = toPt(e)
    const [px, py] = live.pts[live.pts.length - 1]
    if (Math.hypot(p[0] - px, p[1] - py) < 0.002) return // distance filter
    live.pts.push(p)
  }

  function up() {
    const live = liveRef.current
    liveRef.current = null
    if (!live || !live.pts.length) return
    const sm = new Y.Map()
    sm.set('id', `${identity.id}-${Date.now()}`)
    sm.set('by', identity.name)
    sm.set('color', live.color)
    sm.set('size', live.size)
    sm.set('pts', live.pts)
    doodles.push([sm]) // ONE CRDT op per stroke
  }

  // ── board actions ─────────────────────────────────────────────────────
  function undoMine() {
    for (let i = doodles.length - 1; i >= 0; i--) {
      if (doodles.get(i).get('by') === identity.name) {
        doodles.delete(i, 1)
        return
      }
    }
  }

  function clearAll() {
    if (doodles.length) doodles.delete(0, doodles.length)
  }

  return (
    <div className="doodle-panel">
      <header className="doodle-head">
        <h2>🎨 doodle board</h2>
        <div className="doodle-tools">
          <div className="doodle-swatches">
            {PALETTE.map((p) => (
              <button
                key={p}
                type="button"
                className={`swatch${color === p && !eraser ? ' is-active' : ''}`}
                style={{ background: p }}
                onClick={() => {
                  setColor(p)
                  setEraser(false)
                }}
                aria-label={`color ${p}`}
              />
            ))}
          </div>
          <div className="doodle-sizes">
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className={`dsize${size === s ? ' is-active' : ''}`}
                onClick={() => setSize(s)}
                title={`${s}px`}
              >
                <i style={{ width: s / 2.4 + 3, height: s / 2.4 + 3 }} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`doodle-btn${eraser ? ' is-active' : ''}`}
            onClick={() => setEraser((v) => !v)}
          >
            🧽 eraser
          </button>
          <button type="button" className="doodle-btn" onClick={undoMine} title="undo my last stroke">
            ↩︎ mine
          </button>
          <button type="button" className="doodle-btn is-danger" onClick={clearAll}>
            🗑 clear
          </button>
          <SaveButton
            title="download doodle as .png"
            make={() => {
              const c = canvasRef.current
              if (!c || !doodles.length) throw new Error('nothing to save')
              return { name: 'syncpad-doodle.png', dataUrl: c.toDataURL('image/png') }
            }}
          />
        </div>
      </header>

      <div className="doodle-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className={`doodle-canvas${eraser ? ' is-eraser' : ''}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
        />
        {doodles.length === 0 && (
          <div className="doodle-hint">
            yahan draw karo — circles, chem structures, whatever 🖊️
            <small>every stroke is a CRDT op · offline doodles merge on reconnect</small>
          </div>
        )}
      </div>

      <footer className="doodle-foot">
        <span>
          {doodles.length} strokes · {eraser ? 'eraser mode 🧽' : 'pen mode'}
        </span>
        <span className="doodle-credit">
          last: {doodles.length ? doodles.get(doodles.length - 1).get('by') : '—'}
        </span>
      </footer>
    </div>
  )
}
