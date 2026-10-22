// 📽 Shared viewer — the study room's "explain this" screen. Muskan opens a
// PDF / video / image from her laptop and the file itself travels to every
// peer INSIDE THE CRDT: Yjs stores Uint8Array natively, so the bytes sync
// like any other shared value — offline-first, zero upload server, zero
// WebRTC channel juggling. PDFs render with pdf.js (lazy-loaded so the
// main bundle stays lean), page flips sync for everyone, videos follow the
// presenter's playhead. Pair with the 🎥 call to narrate live.
//
// ✏️ COLLAB ANNOTATIONS — a transparent canvas overlays whatever is on screen
// so the room can mark it up together: pencil, highlighter, eraser, text,
// line, arrow, box, ellipse, plus a live laser pointer for presenting. Every
// finished mark is ONE Y.Map pushed into a nested 'marks' Y.Array, stored
// NORMALIZED (0..1) and tagged with its page, so drawings are resolution-
// independent, survive offline merge, and only show on the page they belong
// to. The eraser hit-tests and deletes real marks (not a bg-paint), so it
// works over a PDF. Annotations never block the media: the overlay only
// drinks pointer events while a tool is armed (🖐️ move hands control back).

import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import SaveButton from './SaveButton.jsx'

const MAX_MB = 30

const PALETTE = ['#ff5d8f', '#ff9e6d', '#ffd166', '#a6e86b', '#3ddc97', '#22d3ee', '#6ea8fe', '#a78bfa', '#f472b6', '#ffffff']
const SIZES = [4, 8, 16]
const TOOLS = [
  { id: 'pan', icon: '🖐️', label: 'move / scroll' },
  { id: 'pen', icon: '✏️', label: 'pencil' },
  { id: 'hl', icon: '🖍️', label: 'highlighter' },
  { id: 'text', icon: '🅰️', label: 'text' },
  { id: 'arrow', icon: '↗', label: 'arrow' },
  { id: 'line', icon: '╱', label: 'line' },
  { id: 'rect', icon: '▭', label: 'box' },
  { id: 'ellipse', icon: '◯', label: 'ellipse' },
  { id: 'laser', icon: '🎯', label: 'laser pointer (live)' },
  { id: 'eraser', icon: '🧽', label: 'eraser' },
]
const CURSORS = { pan: 'default', text: 'text', eraser: 'cell', laser: 'none' }

const kindOf = (f) =>
  f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    ? 'pdf'
    : f.type.startsWith('video/')
      ? 'video'
      : f.type.startsWith('image/')
        ? 'image'
        : null

const clamp01 = (n) => Math.min(1, Math.max(0, n))

export default function ViewerPanel({ viewer, identity }) {
  const [, force] = useState(0)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [pdfPages, setPdfPages] = useState(0)
  const [fitKey, setFitKey] = useState(0)

  // ── annotation state ─────────────────────────────────────────────────────
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState(PALETTE[0])
  const [size, setSize] = useState(8)
  const [draft, setDraft] = useState(null) // in-progress text box {x,y,text}
  const [reloadKey, setReloadKey] = useState(0) // bump to re-run the pdf render
  const [zoom, setZoom] = useState(1) // pdf zoom; 1 = fit-to-width. The stage
  // scrolls internally, so zooming enlarges the page INSIDE the fixed box.

  const fileRef = useRef(null)
  const canvasRef = useRef(null)
  const videoRef = useRef(null)
  const imgRef = useRef(null)
  const pdfDoc = useRef(null)
  const renderTask = useRef(null)
  const objUrl = useRef(null)
  const lastBroadcast = useRef(0)

  // overlay + drawing refs
  const frameRef = useRef(null)
  const stageRef = useRef(null)
  const panRef = useRef(null) // live 🖐️ grab-to-pan gesture
  const markRef = useRef(null)
  const drawingRef = useRef(null) // live stroke/shape (not yet CRDT-committed)
  const rafRef = useRef(0)
  const lastLaser = useRef(0)
  const suppressErrRef = useRef(false) // user dismissed the banner → stop re-raising

  const pageNow = () => viewer.get('page') || 1
  const marksArr = () => {
    const m = viewer.get('marks')
    return m instanceof Y.Array ? m : null
  }

  useEffect(() => {
    const obs = () => {
      force((v) => v + 1)
      schedulePaint() // nested marks + live-laser updates must repaint the overlay
    }
    viewer.observeDeep(obs) // nested 'marks' array changes must repaint too
    return () => viewer.unobserveDeep(obs)
  }, [viewer])

  const kind = viewer.get('kind') || null
  const fileName = viewer.get('name') || ''
  const presenter = viewer.get('by') || ''
  const isPresenter = viewer.get('byId') === identity.id
  const pages = viewer.get('pages') || pdfPages
  const page = viewer.get('page') || 1
  const stamp = viewer.get('t') || 0

  // ── open a file (anyone may present — whoever opens last steers) ─────────
  async function openFile(f) {
    setErr(null)
    setZoom(1)
    const k = kindOf(f)
    if (!k) return setErr('pdf / video / image only 🙏')
    if (f.size > MAX_MB * 1024 * 1024) return setErr(`max ${MAX_MB}MB for now 😅 (${(f.size / 1048576).toFixed(1)}MB)`)
    const bytes = new Uint8Array(await f.arrayBuffer())
    Y.transact(viewer.doc, () => {
      viewer.set('bytes', bytes)
      viewer.set('kind', k)
      viewer.set('name', f.name)
      viewer.set('type', f.type || 'application/octet-stream')
      viewer.set('by', identity.name)
      viewer.set('byId', identity.id)
      viewer.set('emoji', identity.emoji || '🧑‍🎓')
      viewer.set('pages', 0)
      viewer.set('page', 1)
      viewer.set('seek', 0)
      viewer.set('playing', false)
      viewer.set('t', Date.now())
    })
  }

  // ── load whatever the CRDT just delivered ────────────────────────────────
  useEffect(() => {
    let dead = false
    suppressErrRef.current = false
    // pdf.js render loops are rAF-driven, so a background/minimised tab can
    // stall a render forever. Watchdog keeps the pane from hanging on
    // "rendering…" with no escape route.
    const watchdog = setTimeout(() => {
      if (dead || suppressErrRef.current) return
      setLoading(false)
      setErr('pdf is taking too long 😅 open the file again to retry')
    }, 20000)
    async function load() {
      if (pdfDoc.current) {
        if (renderTask.current) {
          try {
            renderTask.current.cancel()
          } catch {}
          renderTask.current = null
        }
        pdfDoc.current.destroy?.().catch?.(() => {})
        pdfDoc.current = null
      }
      if (objUrl.current) {
        URL.revokeObjectURL(objUrl.current)
        objUrl.current = null
      }
      const bytes = viewer.get('bytes')
      const k = viewer.get('kind')
      if (!bytes || !k) return
      if (k === 'pdf') {
        setLoading(true)
        try {
          const pdfjs = await import('pdfjs-dist')
          const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
          pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
          const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise // copy — never let pdf.js detach CRDT bytes
          if (dead) return void doc.destroy()
          pdfDoc.current = doc
          setPdfPages(doc.numPages)
          // Only the presenter publishes the page count — a viewer writing it
          // back would turn every late join into a pointless CRDT update.
          if (viewer.get('byId') === identity.id && viewer.get('pages') !== doc.numPages)
            viewer.set('pages', doc.numPages)
          await drawPage(viewer.get('page') || 1)
        } catch {
          if (!dead && !suppressErrRef.current) setErr('pdf failed to open 😅')
        } finally {
          if (!dead) setLoading(false)
        }
      } else {
        const blob = new Blob([bytes], { type: viewer.get('type') || 'application/octet-stream' })
        objUrl.current = URL.createObjectURL(blob)
        force((v) => v + 1)
      }
    }
    load()
    return () => {
      dead = true
      clearTimeout(watchdog)
      if (renderTask.current) {
        try {
          renderTask.current.cancel()
        } catch {}
        renderTask.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, stamp, reloadKey])

  // page flips sync — this effect runs for every peer when 'page' changes;
  // also re-renders on zoom (fitKey bumps when the box is resized)
  useEffect(() => {
    if (pdfDoc.current) drawPage(page).catch(() => setErr('pdf failed to open 😅'))
    schedulePaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fitKey, zoom])

  // refit the rendered page whenever the STAGE box changes — dragging the
  // frame, an S/M/L preset, or a window resize all flow through here, so the
  // pdf always fills the current width (zoom is multiplied on top of that).
  useEffect(() => {
    if (kind !== 'pdf') return
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let t = null
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => setFitKey((v) => v + 1), 150)
    })
    ro.observe(el)
    return () => {
      clearTimeout(t)
      ro.disconnect()
    }
  }, [kind])

  // A trackpad pinch fires as ctrl+wheel, which the browser turns into a
  // whole-PAGE zoom. Hijack it inside the stage so pinching zooms ONLY the pdf
  // (inside the fixed box). Plain two-finger scroll (no ctrl) is left alone so
  // it pans the overflowing page natively.
  useEffect(() => {
    if (kind !== 'pdf') return
    const s = stageRef.current
    if (!s) return
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault() // stop the browser zooming the whole web page
      const factor = Math.exp(-e.deltaY * 0.01) // pinch out → zoom in
      setZoom((z) => Math.min(4, Math.max(0.4, +(z * factor).toFixed(3))))
    }
    s.addEventListener('wheel', onWheel, { passive: false }) // passive:false so preventDefault works
    return () => s.removeEventListener('wheel', onWheel)
  }, [kind])

  async function drawPage(p) {
    const doc = pdfDoc.current
    const c = canvasRef.current
    if (!doc || !c) return
    // One render per canvas at a time — a fast page flip (or a resize refit)
    // while the previous paint is still running otherwise throws
    // "Cannot use the same canvas during multiple render() operations".
    if (renderTask.current) {
      try {
        renderTask.current.cancel()
      } catch {}
      renderTask.current = null
    }
    const pg = await doc.getPage(Math.min(Math.max(1, p), doc.numPages))
    const dpr = window.devicePixelRatio || 1
    const base = pg.getViewport({ scale: 1 })
    // measure the STAGE, not the shrink-wrapping .viewer-frame parent — the
    // frame hugs the canvas, so reading its width collapses the page in a loop
    const stage = c.closest('.viewer-stage')
    const width = stage?.clientWidth || c.parentElement?.clientWidth || 800
    const vp = pg.getViewport({ scale: ((width - 16) / base.width) * dpr * zoom })
    c.width = vp.width
    c.height = vp.height
    c.style.width = `${vp.width / dpr}px`
    c.style.height = `${vp.height / dpr}px`
    const task = pg.render({ canvasContext: c.getContext('2d'), viewport: vp })
    renderTask.current = task
    try {
      await task.promise
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') throw e // cancelled = superseded, totally normal
    } finally {
      if (renderTask.current === task) renderTask.current = null
    }
    setErr(null) // a fresh successful paint clears any earlier "too slow" chip
  }

  const setPage = (p) => {
    viewer.set('page', Math.min(Math.max(1, p), pages || 1))
  }

  // ── video follow-along: presenter broadcasts, others obey ────────────────
  function onTimeUpdate() {
    const v = videoRef.current
    if (!v || !isPresenter) return
    if (!v.paused && Date.now() - lastBroadcast.current > 2000) {
      lastBroadcast.current = Date.now()
      viewer.set('seek', Math.round(v.currentTime))
      viewer.set('playing', true)
    }
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v || isPresenter || kind !== 'video') return
    const s = viewer.get('seek') || 0
    const playing = !!viewer.get('playing')
    if (Math.abs(v.currentTime - s) > 1.5) v.currentTime = s
    if (playing && v.paused) v.play().catch(() => {})
    if (!playing && !v.paused) v.pause()
  })

  function closeFile() {
    Y.transact(viewer.doc, () => {
      for (const k of [...viewer.keys()]) viewer.delete(k)
    })
    setErr(null)
    setDraft(null)
    setZoom(1)
  }

  // ══ ANNOTATION ENGINE ═══════════════════════════════════════════════════

  // repaint the overlay; self-loops while a live stroke or a fresh laser is on
  // screen so drawing feels instant and the laser fades smoothly.
  function schedulePaint() {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      paint()
    })
  }

  function laserRecent() {
    const raw = viewer.get('laser')
    if (!raw) return false
    try {
      const l = JSON.parse(raw)
      return Date.now() - l.t < 1500
    } catch {
      return false
    }
  }

  function paint() {
    const c = markRef.current
    const frame = frameRef.current
    if (!c || !frame) return
    const dpr = window.devicePixelRatio || 1
    const w = frame.clientWidth
    const h = frame.clientHeight
    if (!w || !h) return
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      c.style.width = `${w}px`
      c.style.height = `${h}px`
    }
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const pg = pageNow()
    const m = marksArr()
    if (m) m.forEach((ym) => { const o = ym.toJSON(); if (o.page === pg) drawMark(ctx, o, w, h) })
    if (drawingRef.current) drawMark(ctx, drawingRef.current, w, h)
    drawLaser(ctx, w, h)
    if (drawingRef.current || laserRecent())
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        paint()
      })
  }

  function strokeSmooth(ctx, pts) {
    if (pts.length === 1) {
      ctx.beginPath()
      ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[i + 1]
      ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2)
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
    ctx.stroke()
  }

  function drawMark(ctx, mk, w, h) {
    const S = w / 900 // scale stroke widths so marks look the same at any size
    const pts = (mk.pts || []).map(([x, y]) => [x * w, y * h])
    if (!pts.length) return
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = ctx.fillStyle = mk.color || '#fff'
    const lw = Math.max(1, (mk.size || 4) * S)
    switch (mk.tool) {
      case 'pen':
      case 'hl':
        ctx.globalAlpha = mk.tool === 'hl' ? 0.35 : 1
        ctx.lineWidth = Math.max(1, lw * (mk.tool === 'hl' ? 3.2 : 1))
        strokeSmooth(ctx, pts)
        break
      case 'line':
        ctx.lineWidth = lw
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
        ctx.stroke()
        break
      case 'arrow': {
        ctx.lineWidth = lw
        const [a, b] = [pts[0], pts[pts.length - 1]]
        ctx.beginPath()
        ctx.moveTo(a[0], a[1])
        ctx.lineTo(b[0], b[1])
        ctx.stroke()
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
        const head = 12 * S + lw * 1.6
        ctx.beginPath()
        ctx.moveTo(b[0], b[1])
        ctx.lineTo(b[0] - head * Math.cos(ang - 0.4), b[1] - head * Math.sin(ang - 0.4))
        ctx.moveTo(b[0], b[1])
        ctx.lineTo(b[0] - head * Math.cos(ang + 0.4), b[1] - head * Math.sin(ang + 0.4))
        ctx.stroke()
        break
      }
      case 'rect': {
        ctx.lineWidth = lw
        const [p, q] = [pts[0], pts[pts.length - 1]]
        ctx.strokeRect(Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]))
        break
      }
      case 'ellipse': {
        ctx.lineWidth = lw
        const [p, q] = [pts[0], pts[pts.length - 1]]
        ctx.beginPath()
        ctx.ellipse((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, Math.abs(q[0] - p[0]) / 2, Math.abs(q[1] - p[1]) / 2, 0, 0, Math.PI * 2)
        ctx.stroke()
        break
      }
      case 'text': {
        const fs = Math.max(13, (mk.size || 8) * 5 * S)
        ctx.font = `700 ${fs}px ui-sans-serif, system-ui, sans-serif`
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,0.55)'
        ctx.shadowBlur = 4
        ctx.fillText(mk.text || '', pts[0][0], pts[0][1])
        break
      }
      default:
        break
    }
    ctx.restore()
  }

  function drawLaser(ctx, w, h) {
    const raw = viewer.get('laser')
    if (!raw) return
    let l
    try {
      l = JSON.parse(raw)
    } catch {
      return
    }
    const age = Date.now() - l.t
    if (age > 1500) return
    const alpha = Math.max(0, 1 - age / 1500)
    const x = l.x * w
    const y = l.y * h
    ctx.save()
    ctx.globalAlpha = alpha
    const g = ctx.createRadialGradient(x, y, 0, x, y, 20)
    g.addColorStop(0, 'rgba(255,70,100,0.95)')
    g.addColorStop(1, 'rgba(255,70,100,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, 20, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ff3c5a'
    ctx.beginPath()
    ctx.arc(x, y, 4.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  function toPt(e) {
    const r = frameRef.current.getBoundingClientRect()
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]
  }

  function addMark(o) {
    let m = viewer.get('marks')
    if (!(m instanceof Y.Array)) {
      m = new Y.Array()
      viewer.set('marks', m)
    }
    const ym = new Y.Map()
    Object.entries(o).forEach(([k, v]) => ym.set(k, v))
    m.push([ym]) // ONE CRDT op per mark
  }

  function eraseAt(p) {
    const m = marksArr()
    if (!m) return
    const pg = pageNow()
    const r = 0.035
    for (let i = m.length - 1; i >= 0; i--) {
      const mk = m.get(i)
      if (mk.get('page') !== pg) continue
      const pts = mk.get('pts') || []
      if (pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < r)) m.delete(i, 1)
    }
  }

  function broadcastLaser(p) {
    const now = Date.now()
    if (now - lastLaser.current < 40) return // throttle the wire
    lastLaser.current = now
    viewer.set('laser', JSON.stringify({ id: identity.id, name: identity.name, emoji: identity.emoji, x: p[0], y: p[1], t: now }))
  }

  function onDown(e) {
    if (tool === 'pan' || !kind) return
    const p = toPt(e)
    if (tool === 'laser') {
      broadcastLaser(p)
      return
    }
    if (tool === 'text') {
      setDraft({ x: p[0], y: p[1], text: '' })
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'eraser') {
      drawingRef.current = { erase: true }
      eraseAt(p)
      return
    }
    const freehand = tool === 'pen' || tool === 'hl'
    drawingRef.current = { tool, color, size, page: pageNow(), by: identity.name, pts: freehand ? [p] : [p, p] }
    schedulePaint()
  }

  function onMove(e) {
    if (tool === 'laser') {
      if (kind) broadcastLaser(toPt(e))
      return
    }
    const d = drawingRef.current
    if (!d) return
    const p = toPt(e)
    if (d.erase) {
      eraseAt(p)
      return
    }
    if (d.tool === 'pen' || d.tool === 'hl') {
      const last = d.pts[d.pts.length - 1]
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002) return // distance filter
      d.pts.push(p)
    } else {
      d.pts[1] = p // shapes track the drag corner
    }
    schedulePaint()
  }

  function onUp() {
    const d = drawingRef.current
    drawingRef.current = null
    if (!d || d.erase) {
      schedulePaint()
      return
    }
    if (d.pts.length) addMark(d)
  }

  // ── 🖐️ grab-to-pan: drag the stage to move around a zoomed-in page ───────
  function onStageDown(e) {
    if (tool !== 'pan') return
    const s = stageRef.current
    if (!s) return
    // never hijack a click on a real control living inside the stage
    if (e.target.closest('button, input, textarea, select, a')) return
    // nothing to scroll? then stay out of the way so media controls still work
    if (s.scrollWidth <= s.clientWidth && s.scrollHeight <= s.clientHeight) return
    e.preventDefault()
    s.setPointerCapture(e.pointerId)
    panRef.current = { x: e.clientX, y: e.clientY, left: s.scrollLeft, top: s.scrollTop }
    s.classList.add('is-grabbing')
  }
  function onStageMove(e) {
    const p = panRef.current
    const s = stageRef.current
    if (!p || !s) return
    s.scrollLeft = p.left - (e.clientX - p.x)
    s.scrollTop = p.top - (e.clientY - p.y)
  }
  function onStageUp(e) {
    const s = stageRef.current
    if (!s || !panRef.current) return
    panRef.current = null
    s.classList.remove('is-grabbing')
    try {
      s.releasePointerCapture(e.pointerId)
    } catch {}
  }

  function commitText() {
    if (draft && draft.text.trim()) addMark({ tool: 'text', color, size, page: pageNow(), by: identity.name, pts: [[draft.x, draft.y]], text: draft.text })
    setDraft(null)
    schedulePaint()
  }

  // ── board actions ─────────────────────────────────────────────────────────
  function undoMine() {
    const m = marksArr()
    if (!m) return
    const pg = pageNow()
    for (let i = m.length - 1; i >= 0; i--) {
      if (m.get(i).get('by') === identity.name && m.get(i).get('page') === pg) {
        m.delete(i, 1)
        return
      }
    }
  }
  function clearPage() {
    const m = marksArr()
    if (!m) return
    const pg = pageNow()
    for (let i = m.length - 1; i >= 0; i--) if (m.get(i).get('page') === pg) m.delete(i, 1)
  }
  function clearAll() {
    const m = marksArr()
    if (m && m.length) m.delete(0, m.length)
  }

  function makePng() {
    const frame = frameRef.current
    const overlay = markRef.current
    if (!frame || !overlay) throw new Error('nothing to save')
    const media = kind === 'pdf' ? canvasRef.current : kind === 'video' ? videoRef.current : imgRef.current
    const out = document.createElement('canvas')
    out.width = overlay.width
    out.height = overlay.height
    const ctx = out.getContext('2d')
    ctx.fillStyle = '#0d1023'
    ctx.fillRect(0, 0, out.width, out.height)
    if (media) ctx.drawImage(media, 0, 0, out.width, out.height)
    ctx.drawImage(overlay, 0, 0)
    return { name: `syncpad-${fileName || 'viewer'}-p${pageNow()}.png`, dataUrl: out.toDataURL('image/png') }
  }

  // keep the overlay glued to the media box as it resizes / refits
  useEffect(() => {
    if (!frameRef.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => schedulePaint())
    ro.observe(frameRef.current)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  useEffect(() => {
    schedulePaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, page, tool, color, size, draft])

  const armed = tool !== 'pan' && !!kind
  const markCount = marksArr()?.length || 0

  const empty = !kind

  return (
    <div className="viewer-panel">
      <header className="viewer-head">
        <h2>📽 shared viewer</h2>
        <div className="viewer-tools">
          {kind && <span className="viewer-file" title={fileName}>{fileName}</span>}
          {kind && <span className="viewer-by">{viewer.get('emoji') || '🧑🎓'} {presenter || 'someone'} presenting</span>}
          <button
            type="button"
            className="doodle-btn"
            onClick={() => fileRef.current?.click()}
            title="open a pdf / video / image from your device — it syncs to everyone"
          >
            📂 open file
          </button>
          {(kind || err) && (
            <button type="button" className="doodle-btn is-danger" onClick={closeFile} title="close / reset the viewer">
              ✕ close
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,video/*,image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) openFile(f)
            }}
          />
        </div>
      </header>

      {kind && (
        <div className="viewer-annotate">
          <div className="va-tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`va-tool${tool === t.id ? ' is-active' : ''}`}
                onClick={() => {
                  setTool(t.id)
                  setDraft(null)
                }}
                title={t.label}
              >
                <span className="va-ico">{t.icon}</span>
              </button>
            ))}
          </div>
          <div className="va-swatches">
            {PALETTE.map((p) => (
              <button
                key={p}
                type="button"
                className={`swatch${color === p ? ' is-active' : ''}`}
                style={{ background: p, ['--sw']: p }}
                onClick={() => setColor(p)}
                aria-label={`color ${p}`}
              />
            ))}
          </div>
          <div className="va-sizes">
            {SIZES.map((s) => (
              <button key={s} type="button" className={`dsize${size === s ? ' is-active' : ''}`} onClick={() => setSize(s)} title={`${s}px`}>
                <i style={{ width: s / 2 + 4, height: s / 2 + 4 }} />
              </button>
            ))}
          </div>
          <div className="va-actions">
            <button type="button" className="doodle-btn" onClick={undoMine} title="undo my last mark on this page">
              ↩︎ mine
            </button>
            <button type="button" className="doodle-btn" onClick={clearPage} title="clear marks on this page">
              🧹 page
            </button>
            <button type="button" className="doodle-btn is-danger" onClick={clearAll} title="clear every mark">
              🗑 all
            </button>
            <SaveButton title="download this page with your marks as .png" make={makePng} />
          </div>
        </div>
      )}

      <div
        ref={stageRef}
        className={`viewer-stage${tool === 'pan' ? ' is-pan' : ''}`}
        onPointerDown={onStageDown}
        onPointerMove={onStageMove}
        onPointerUp={onStageUp}
        onPointerCancel={onStageUp}
      >
        {err && (
          <div className="viewer-err">
            <span className="viewer-err-msg">⚠️ {err}</span>
            <span className="viewer-err-actions">
              {kind && (
                <button
                  type="button"
                  className="viewer-err-btn"
                  onClick={() => {
                    setErr(null)
                    setReloadKey((v) => v + 1)
                  }}
                  title="try rendering it again"
                >
                  ↻ retry
                </button>
              )}
              <button
                type="button"
                className="viewer-err-x"
                onClick={() => {
                  suppressErrRef.current = true
                  setErr(null)
                }}
                title="dismiss (keeps the file open)"
              >
                ✕
              </button>
            </span>
          </div>
        )}
        {kind && (
          <div className={`viewer-frame${kind === 'video' ? ' is-video' : ''}`} ref={frameRef}>
            {kind === 'pdf' && <canvas ref={canvasRef} className={`viewer-canvas${loading ? ' is-warming' : ''}`} />}
            {kind === 'video' && objUrl.current && (
              <video
                ref={videoRef}
                className="viewer-video"
                src={objUrl.current}
                controls
                playsInline
                onTimeUpdate={onTimeUpdate}
                onPlay={() => isPresenter && viewer.set('playing', true)}
                onPause={() => isPresenter && viewer.set('playing', false)}
              />
            )}
            {kind === 'image' && objUrl.current && <img ref={imgRef} className="viewer-img" src={objUrl.current} alt={fileName} />}

            <canvas
              ref={markRef}
              className={`viewer-marks${armed ? ' is-armed' : ''}${tool === 'laser' ? ' is-laser' : ''}`}
              style={{ cursor: CURSORS[tool] || 'crosshair' }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onUp}
            />

            {draft && (
              <input
                className="viewer-text-input"
                autoFocus
                value={draft.text}
                style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, color }}
                placeholder="type…"
                onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                onBlur={commitText}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitText()
                  if (e.key === 'Escape') setDraft(null)
                }}
              />
            )}
          </div>
        )}
        {loading && <div className="viewer-loading">rendering the pdf… 📄</div>}

        {empty && !err && (
          <div className="viewer-empty">
            <div className="viewer-empty-icon">📽</div>
            <p>
              <b>open anything, everyone watches &amp; marks it up together</b>
            </p>
            <p className="viewer-empty-sub">
              pdf notes, a lecture video, a diagram — the file itself rides inside the shared
              document (CRDT binary sync ✨), so pages &amp; playhead follow the presenter. Then grab
              the ✏️ pencil, 🖍️ highlighter, 🅰️ text or 🎯 laser and explain it live to the room.
            </p>
            <button type="button" className="viewer-open-big" onClick={() => fileRef.current?.click()}>
              📂 pick a file from your laptop
            </button>
            <p className="viewer-empty-foot">
              tip: hop on the 🎥 call too — explain with voice while friends watch 👄🎙
            </p>
          </div>
        )}
      </div>

      {kind === 'pdf' && pages > 0 && (
        <footer className="viewer-foot">
          <button type="button" className="doodle-btn" onClick={() => setPage(page - 1)} disabled={page <= 1}>
            ◀
          </button>
          <span className="viewer-page">
            {page} / {pages}
          </span>
          <button type="button" className="doodle-btn" onClick={() => setPage(page + 1)} disabled={page >= pages}>
            ▶
          </button>
          <div className="viewer-zoom">
            <button
              type="button"
              className="doodle-btn"
              onClick={() => setZoom((z) => Math.max(0.4, +(z / 1.25).toFixed(3)))}
              title="zoom out"
            >
              ➖
            </button>
            <button
              type="button"
              className="viewer-zoom-val"
              onClick={() => setZoom(1)}
              title="reset to fit width"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="doodle-btn"
              onClick={() => setZoom((z) => Math.min(4, +(z * 1.25).toFixed(3)))}
              title="zoom in"
            >
              ➕
            </button>
          </div>
          <span className="viewer-sync-hint">
            {isPresenter
              ? 'you drive — flips sync to the room 🧭'
              : `following ${presenter || 'the presenter'} 🫡`}
          </span>
          {markCount > 0 && <span className="viewer-mark-count">✏️ {markCount} mark{markCount > 1 ? 's' : ''} on this page</span>}
        </footer>
      )}
      {kind === 'video' && (
        <footer className="viewer-foot">
          <span className="viewer-sync-hint">
            {isPresenter ? 'you drive — playhead broadcasts to everyone 🧭' : 'following the presenter 🫡'}
          </span>
          {markCount > 0 && <span className="viewer-mark-count">✏️ {markCount} mark{markCount > 1 ? 's' : ''}</span>}
        </footer>
      )}
    </div>
  )
}
