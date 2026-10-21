// 🫂 Daily check-in — a BeReal-shaped habit for the pad: once per calendar
// day, anyone can drop a one-liner ("subah se chemistry torture 🫠"). Entries
// live in a 'checkins' Y.Map keyed by clientID, each stamped with the local
// day — so everyone gets exactly one check-in per day, it syncs naturally,
// and yesterday's entries quietly expire from view (keys just get overwritten).

import { useEffect, useState } from 'react'

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export default function CheckinBar({ checkinsMap, identity }) {
  const [, force] = useState(0)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const obs = () => force((v) => v + 1)
    checkinsMap.observe(obs)
    return () => checkinsMap.unobserve(obs)
  }, [checkinsMap])

  const today = todayKey()
  const entries = [...checkinsMap.entries()]
    .map(([, v]) => v)
    .filter((e) => e?.date === today)
    .sort((a, b) => (a.t || 0) - (b.t || 0))

  const mine = entries.find((e) => e.id === identity.id)

  function share() {
    const text = draft.trim().slice(0, 100)
    if (!text) return
    checkinsMap.set(String(identity.id), {
      id: identity.id,
      date: today,
      text,
      name: identity.name,
      emoji: identity.emoji,
      t: Date.now(),
    })
    setDraft('')
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        className={`checkin-btn${mine ? ' is-in' : ''}`}
        onClick={() => setOpen(true)}
        title="aaj ka check-in — how is the room actually doing?"
      >
        <span>🫂</span>
        <span>
          {mine ? 'aaj ka check-in ho gaya ✓' : 'aaj tune check-in kiya?'}{' '}
          <b>{entries.length}</b>
        </span>
      </button>

      {open && (
        <div className="recap-overlay" onClick={() => setOpen(false)}>
          <div className="checkin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="recap-head">
              <span>🫂 aaj ke check-ins</span>
              <button type="button" className="recap-close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <div className="checkin-list">
              {entries.length === 0 && (
                <p className="checkin-empty">
                  abhi koi nahi bola — tum ho na, shuru karo 🫱
                </p>
              )}
              {entries.map((e, i) => (
                <div key={`${e.id}-${i}`} className={`checkin-row${e.id === identity.id ? ' is-mine' : ''}`}>
                  <span className="checkin-face">{e.emoji}</span>
                  <div>
                    <b>{e.name}</b>
                    <p>{e.text}</p>
                    <small>
                      {new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </small>
                  </div>
                </div>
              ))}
            </div>

            <form
              className="checkin-form"
              onSubmit={(ev) => {
                ev.preventDefault()
                share()
              }}
            >
              <input
                autoFocus
                value={mine ? mine.text : draft}
                maxLength={100}
                disabled={!!mine}
                placeholder={mine ? 'daily ek hi shot — kal phir 😌' : 'aaj kaisa chal raha hai…'}
                onChange={(ev) => setDraft(ev.target.value)}
              />
              <button type="submit" disabled={!!mine || !draft.trim()}>
                {mine ? '✓ done' : 'share'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
