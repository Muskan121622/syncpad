// 📊 Session recap modal — builds the stats from live CRDT data, paints the
// story card on a canvas, previews it, and exports a 1080×1920 PNG your
// group will actually post on stories.

import { useEffect, useState } from 'react'
import { computeRecap, drawRecapCard } from '../lib/recap.js'

export default function RecapCard({ ydoc, timeline, peers, counters, padId, vibe, onClose }) {
  const [img, setImg] = useState(null)
  const [recap, setRecap] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    // never let stats/painting crash the app tree — degrade to an error card
    let r
    try {
      r = computeRecap({ ydoc, timeline, peers, counters: counters.current, padId, vibe })
      setRecap(r)
    } catch (err) {
      console.error('recap compute failed:', err)
      setFailed(true)
      return
    }
    // wait for webfonts so the canvas paints in Space Grotesk, not fallback
    const paint = () => {
      if (!alive) return
      try {
        setImg(drawRecapCard(r).toDataURL('image/png'))
      } catch (err) {
        console.error('recap paint failed:', err)
        setFailed(true)
      }
    }
    if (document.fonts?.ready) document.fonts.ready.then(paint).catch(paint)
    else paint()
    return () => {
      alive = false
    }
    // intentionally snapshot-on-open: stats freeze when you open the card
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function download() {
    if (!img) return
    const a = document.createElement('a')
    a.href = img
    a.download = `syncpad-${padId}-recap.png`
    a.click()
  }

  return (
    <div className="recap-overlay" onClick={onClose}>
      <div className="recap-modal" onClick={(e) => e.stopPropagation()}>
        <div className="recap-head">
          <span>📊 your pad, wrapped</span>
          <button type="button" className="recap-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="recap-stage">
          {failed ? (
            <div className="recap-loading">recap hit a snag 😅 close & retry</div>
          ) : img ? (
            <img className="recap-img" src={img} alt="session recap card" />
          ) : (
            <div className="recap-loading">painting your stats… 🎨</div>
          )}
        </div>

        {recap && (
          <div className="recap-meta">
            <span>
              {recap.words} words · {recap.people.length} writers · {recap.reactions} reactions
            </span>
            <button type="button" className="recap-save" onClick={download} disabled={!img}>
              ⬇ save story card
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
