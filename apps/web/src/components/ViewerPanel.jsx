// 📽 Shared viewer — the study room's "explain this" screen. Muskan opens a
// PDF / video / image from her laptop and the file itself travels to every
// peer INSIDE THE CRDT: Yjs stores Uint8Array natively, so the bytes sync
// like any other shared value — offline-first, zero upload server, zero
// WebRTC channel juggling. PDFs render with pdf.js (lazy-loaded so the
// main bundle stays lean), page flips sync for everyone, videos follow the
// presenter's playhead. Pair with the 🎥 call to narrate live.

import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'

const MAX_MB = 30

const kindOf = (f) =>
  f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    ? 'pdf'
    : f.type.startsWith('video/')
      ? 'video'
      : f.type.startsWith('image/')
        ? 'image'
        : null

export default function ViewerPanel({ viewer, identity }) {
  const [, force] = useState(0)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [pdfPages, setPdfPages] = useState(0)
  const [fitKey, setFitKey] = useState(0)
  const fileRef = useRef(null)
  const canvasRef = useRef(null)
  const videoRef = useRef(null)
  const pdfDoc = useRef(null)
  const renderTask = useRef(null)
  const objUrl = useRef(null)
  const lastBroadcast = useRef(0)

  useEffect(() => {
    const obs = () => force((v) => v + 1)
    viewer.observe(obs)
    return () => viewer.unobserve(obs)
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
    // pdf.js render loops are rAF-driven, so a background/minimised tab can
    // stall a render forever. Watchdog keeps the pane from hanging on
    // "rendering…" with no escape route.
    const watchdog = setTimeout(() => {
      if (dead) return
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
          if (!dead) setErr('pdf failed to open 😅')
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
  }, [kind, stamp])

  // page flips sync — this effect runs for every peer when 'page' changes
  useEffect(() => {
    if (pdfDoc.current) drawPage(page).catch(() => setErr('pdf failed to open 😅'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fitKey])

  // refit the rendered page when the pane width changes (window resize)
  useEffect(() => {
    if (kind !== 'pdf') return
    let t = null
    const onResize = () => {
      clearTimeout(t)
      t = setTimeout(() => setFitKey((v) => v + 1), 220)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', onResize)
    }
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
    const width = c.parentElement?.clientWidth || 800
    const vp = pg.getViewport({ scale: ((width - 16) / base.width) * dpr })
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
  }

  const empty = !kind

  return (
    <div className="viewer-panel">
      <header className="viewer-head">
        <h2>📽 shared viewer</h2>
        <div className="viewer-tools">
          {kind && <span className="viewer-file" title={fileName}>{fileName}</span>}
          {kind && <span className="viewer-by">{viewer.get('emoji') || '🧑‍🎓'} {presenter || 'someone'} presenting</span>}
          <button
            type="button"
            className="doodle-btn"
            onClick={() => fileRef.current?.click()}
            title="open a pdf / video / image from your device — it syncs to everyone"
          >
            📂 open file
          </button>
          {kind && (
            <button type="button" className="doodle-btn is-danger" onClick={closeFile} title="close for everyone">
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

      <div className="viewer-stage">
        {err && <div className="viewer-err">{err}</div>}
        {kind === 'pdf' && (
          <canvas ref={canvasRef} className={`viewer-canvas${loading ? ' is-warming' : ''}`} />
        )}
        {loading && <div className="viewer-loading">rendering the pdf… 📄</div>}

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

        {kind === 'image' && objUrl.current && (
          <img className="viewer-img" src={objUrl.current} alt={fileName} />
        )}

        {empty && !err && (
          <div className="viewer-empty">
            <div className="viewer-empty-icon">📽</div>
            <p>
              <b>open anything, everyone watches together</b>
            </p>
            <p className="viewer-empty-sub">
              pdf notes, a lecture video, a diagram — the file itself rides inside the
              shared document (CRDT binary sync ✨), so pages & playhead follow the presenter.
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
          <span className="viewer-sync-hint">
            {isPresenter
              ? 'you drive — flips sync to the room 🧭'
              : `following ${presenter || 'the presenter'} 🫡`}
          </span>
        </footer>
      )}
      {kind === 'video' && (
        <footer className="viewer-foot">
          <span className="viewer-sync-hint">
            {isPresenter ? 'you drive — playhead broadcasts to everyone 🧭' : 'following the presenter 🫡'}
          </span>
        </footer>
      )}
    </div>
  )
}
