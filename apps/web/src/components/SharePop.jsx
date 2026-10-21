// 📤 SharePop — the Google-style "share moment". One room, many front doors:
// the room link (/r/<key>) plus a direct deep link per tool (/r/<key>/sheet).
// Anyone with a link edits live — no signup, the CRDT does the rest. The room
// key itself is copyable as a code, because reading "k7m2xq9p4tgb" over a
// call is faster than pasting a URL.

import { useEffect, useRef, useState } from 'react'
import { TOOLS } from './ToolRail.jsx'
import { routeUrl, sanitizeKey } from '../lib/routes.js'

const toolUrl = (padId, t) => routeUrl(padId, t)

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // clipboard API blocked (http/permissions) → old-school fallback
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

export default function SharePop({ padId }) {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [joinCode, setJoinCode] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  async function copy(text, msg) {
    setToast((await copyText(text)) ? msg : 'copy failed 😅 use the url bar')
    setTimeout(() => setToast(null), 1700)
  }

  // A friend who was just told the code out loud types it here — no URL needed.
  function join(e) {
    e.preventDefault()
    const key = sanitizeKey(joinCode)
    if (!key) return setToast('type the room code first 😅')
    location.href = routeUrl(key)
  }

  const roomLink = toolUrl(padId)

  return (
    <span className="share-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ghost-btn${open ? ' is-on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="copy the room link — or grab a direct tool link"
      >
        📤 share
      </button>
      {open && (
        <div className="share-pop">
          <h3>share the room 🫵</h3>
          <div className="share-code-row">
            <span className="share-code" title="room code — type this to a friend">
              {padId}
            </span>
            <button type="button" className="share-code-btn" onClick={() => copy(padId, 'room code copied 🔑')}>
              copy code
            </button>
          </div>
          <div className="share-row">
            <input readOnly value={roomLink} onFocus={(e) => e.target.select()} />
            <button type="button" onClick={() => copy(roomLink, 'copied bhai ✅')}>
              copy
            </button>
          </div>
          <p className="share-sub">direct tool links — land straight inside:</p>
          <div className="share-chips">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="share-chip"
                onClick={() => copy(toolUrl(padId, t.id), `${t.label} link copied ${t.icon}`)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <form className="share-join" onSubmit={join}>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="got a code? paste & join →"
              spellCheck="false"
              aria-label="join a room by code"
            />
            <button type="submit">join</button>
          </form>
          <p className="share-foot">anyone with the link can edit — no signup, no app 🧃</p>
          {toast && <span className="share-toast">{toast}</span>}
        </div>
      )}
    </span>
  )
}
