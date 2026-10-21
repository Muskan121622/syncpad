// App shell — owns the pad session, awareness presence, synced vibe, the
// double-click → reaction-burst flow, and the time-rewind deck.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { getPad, fetchStreak } from './lib/pad.js'
import { readRoute, newRoomKey, writeRoute, routeUrl } from './lib/routes.js'
import { loadIdentity, saveIdentity, REACTION_EMOJIS } from './lib/identity.js'
import { applyVibe, normalizeVibe, DEFAULT_VIBE } from './lib/themes.js'
import { createRecorder, buildTimelineFromRecords } from './lib/rewind.js'
import TopBar from './components/TopBar.jsx'
import Editor from './components/Editor.jsx'
import PadFrame from './components/PadFrame.jsx'
import HypeMeter from './components/HypeMeter.jsx'
import ClaimOverlay from './components/ClaimOverlay.jsx'
import FocusBar from './components/FocusBar.jsx'
import StreakChip from './components/StreakChip.jsx'
import GoalBar from './components/GoalBar.jsx'
import LofiToggle from './components/LofiToggle.jsx'
import CheckinBar from './components/CheckinBar.jsx'
import ToolRail, { TOOLS } from './components/ToolRail.jsx'
import CallOverlay from './components/CallOverlay.jsx'
import TasksPanel from './components/TasksPanel.jsx'
import DoodlePanel from './components/DoodlePanel.jsx'
import StickyWall from './components/StickyWall.jsx'
import SheetPanel from './components/SheetPanel.jsx'
import ViewerPanel from './components/ViewerPanel.jsx'
import SaveButton from './components/SaveButton.jsx'
import { padMarkdown } from './lib/export.js'
import RecapCard from './components/RecapCard.jsx'
import RewindBar from './components/RewindBar.jsx'
import ReactionLayer from './components/ReactionLayer.jsx'

const BURST_MS = 2200
const TIMELAPSE_MS = 450
const SLEEP_MS = 90_000 // idle 90s → cursor falls asleep 💤

// A visit with no room key in the URL mints a fresh random one. A shared
// default name would put every stranger in the same document.
const ROUTE = readRoute()
const PAD_ID = ROUTE.padId || newRoomKey()

export default function App() {
  const padId = PAD_ID
  const { ydoc, provider, history, streak: streakPromise } = useMemo(() => getPad(padId), [padId])
  const [identity, setIdentity] = useState(loadIdentity)
  const meta = useMemo(() => ydoc.getMap('meta'), [ydoc])
  const focusMap = useMemo(() => ydoc.getMap('focus'), [ydoc])
  const goalMap = useMemo(() => ydoc.getMap('goal'), [ydoc])
  const checkinsMap = useMemo(() => ydoc.getMap('checkins'), [ydoc])
  const tasksArray = useMemo(() => ydoc.getArray('tasks'), [ydoc])
  const doodlesArray = useMemo(() => ydoc.getArray('doodles'), [ydoc])
  const stickiesMap = useMemo(() => ydoc.getMap('stickies'), [ydoc])
  const sheetMap = useMemo(() => ydoc.getMap('sheet'), [ydoc])
  const viewerMap = useMemo(() => ydoc.getMap('viewer'), [ydoc])
  const callMap = useMemo(() => ydoc.getMap('call'), [ydoc])

  // 🎥 study room call — floating p2p video, lives over every tool
  const [inCall, setInCall] = useState(false)
  const [myClientId, setMyClientId] = useState(0)

  // tool rail — which room tool is showing (pad stays mounted underneath).
  // /r/<key>/<tool> (or a legacy ?t=) deep link wins over last-used — share a
  // sheet link, land in the sheet. The URL then mirrors where you are.
  const [tool, setTool] = useState(() => {
    if (ROUTE.tool && TOOLS.some((x) => x.id === ROUTE.tool)) return ROUTE.tool
    return localStorage.getItem(`syncpad-tool-${padId}`) || 'pad'
  })
  useEffect(() => {
    localStorage.setItem(`syncpad-tool-${padId}`, tool)
    writeRoute(padId, tool)
  }, [tool, padId])

  const [status, setStatus] = useState('connecting')
  const [peers, setPeers] = useState([])
  const onlineIds = useMemo(() => new Set(peers.map((p) => p.clientId)), [peers])
  const [vibe, setVibe] = useState(normalizeVibe(meta.get('vibe') || DEFAULT_VIBE))
  const [reaction, setReaction] = useState('✨')
  const [bursts, setBursts] = useState([])

  // vibe-extras state
  const [zen, setZen] = useState(false)
  const [hype, setHype] = useState(0)
  const [combo, setCombo] = useState(0)
  const [over, setOver] = useState(false)
  const [tick, setTick] = useState(0) // re-render clock for idle detection
  const [showRecap, setShowRecap] = useState(false)
  // session counters feeding the 📊 recap card (this client's point of view)
  const counters = useRef({ reactions: 0, focusSessions: 0, rewinds: 0 })
  const lastLocalBurst = useRef(0)
  const comboTimer = useRef(null)
  const overLatch = useRef(false)

  // typing moods — mine (from the editor's mood engine) rides on awareness
  const [myMood, setMyMood] = useState(null)
  const moodRef = useRef(null)
  const handleMood = useCallback((m) => {
    moodRef.current = m
    setMyMood(m)
  }, [])

  // focus room — phase drives the pad's glow + break-time confetti
  const [focusPhase, setFocusPhase] = useState(() => focusMap.get('phase') || null)

  // group streak — resolved once from the server, then refreshed on edits
  const [streak, setStreak] = useState(0)
  useEffect(() => {
    let alive = true
    streakPromise.then((s) => alive && setStreak(s?.count || 0)).catch(() => {})
    // re-poll while the pad is open so a same-day bump shows without reload
    const id = setInterval(() => {
      fetchStreak(padId).then((s) => alive && s?.count && setStreak(s.count))
    }, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [streakPromise, padId])

  const handleFocusPhase = useCallback(
    (phase) => {
      setFocusPhase(phase)
      if (phase === 'focus') counters.current.focusSessions++
      if (phase === 'break') {
        // session survived — reward the room
        for (let i = 0; i < 8; i++) {
          addBurstRef.current(
            ['☕', '🎉', '🍅', '✨'][i % 4],
            10 + Math.random() * 80,
            12 + Math.random() * 40,
            Math.round((Math.random() - 0.5) * 60),
            `break-${Date.now()}-${i}`,
          )
        }
      }
    },
    [],
  )

  // time-rewind state
  const [timeline, setTimeline] = useState([])
  const [seed, setSeed] = useState(null) // replayed server edit-log, resolved once
  const [rewindIdx, setRewindIdx] = useState(-1) // -1 = living in the present
  const [playing, setPlaying] = useState(false)
  const [previewDoc, setPreviewDoc] = useState(null)

  const stageRef = useRef(null)
  const reactionRef = useRef(reaction)
  reactionRef.current = reaction
  const addBurstRef = useRef(null) // set once addBurst exists (defined below)

  // ── presence: publish identity, mirror room roster into state ──────────
  useEffect(() => {
    const aw = provider.awareness
    if (!aw) return
    setMyClientId(aw.clientID)
    aw.setLocalStateField('user', { ...identity, lastActive: Date.now() })
    const sync = () => {
      const list = []
      aw.states.forEach((s, clientId) => {
        if (s?.user) {
          list.push({ ...s.user, clientId, id: `${clientId}:${s.user.id}`, self: clientId === aw.clientID })
        }
      })
      setPeers(list)
    }
    sync()
    aw.on('change', sync)
    return () => aw.off('change', sync)
  }, [provider, identity])

  // ── connection status ───────────────────────────────────────────────────
  useEffect(() => {
    const onStatus = ({ status: s }) => setStatus(s)
    provider.on('status', onStatus)
    provider.on('connected', () => setStatus('connected'))
    provider.on('disconnected', () => setStatus('disconnected'))
    return () => {
      provider.off('status', onStatus)
    }
  }, [provider])

  // ── vibe: one synced theme for the whole room ───────────────────────────
  useEffect(() => {
    const obs = () => setVibe(normalizeVibe(meta.get('vibe') || DEFAULT_VIBE))
    meta.observe(obs)
    return () => meta.unobserve(obs)
  }, [meta])

  useEffect(() => applyVibe(vibe), [vibe])

  const pickVibe = useCallback(
    (id) => {
      // last-writer-wins on a Y.Map is CRDT-safe — every client converges.
      meta.set('vibe', id)
      setVibe(id)
    },
    [meta],
  )

  // ── reactions: stateless broadcast, never touches document history ─────
  const addBurst = useCallback((emoji, x, y, spin, key, mine = false) => {
    const entry = { key, emoji, x, y, spin, mine }
    setBursts((b) => [...b, entry])
    setHype((h) => Math.min(100, h + (mine ? 6 : 2))) // shared room hype
    counters.current.reactions++
    setTimeout(() => setBursts((b) => b.filter((r) => r.key !== entry.key)), BURST_MS)
  }, [])
  addBurstRef.current = addBurst

  // room-wide emoji celebration (goal done / tasks swept / break reached)
  function celebrate(emojis) {
    for (let i = 0; i < 6; i++) {
      addBurstRef.current(
        emojis[i % emojis.length],
        15 + Math.random() * 70,
        15 + Math.random() * 45,
        Math.random() < 0.5,
        `cel-${Date.now()}-${i}`,
        true,
      )
    }
  }

  useEffect(() => {
    const onStateless = ({ payload }) => {
      try {
        const msg = JSON.parse(payload)
        if (msg.t === 'r' && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
          addBurst(msg.e, msg.x, msg.y, msg.s ?? 0, `${Date.now()}-${Math.random()}`)
        }
      } catch {
        /* ignore non-reaction packets */
      }
    }
    provider.on('stateless', onStateless)
    return () => provider.off('stateless', onStateless)
  }, [provider, addBurst])

  function dropReaction(e) {
    const host = stageRef.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    const spin = Math.round((Math.random() - 0.5) * 50)
    provider.sendStateless(JSON.stringify({ t: 'r', e: reactionRef.current, x, y, s: spin }))
    addBurst(reactionRef.current, x, y, spin, `${Date.now()}-mine`, true)

    // combo: rapid-fire local reactions chain a multiplier
    const now = Date.now()
    setCombo((c) => (now - lastLocalBurst.current < 1000 ? c + 1 : 1))
    lastLocalBurst.current = now
    clearTimeout(comboTimer.current)
    comboTimer.current = setTimeout(() => setCombo(0), 1600)
  }

  // ── hype decay + overdrive ──────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setHype((h) => (h > 0 ? Math.max(0, h - 4) : 0)), 400)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (hype >= 100 && !overLatch.current) {
      overLatch.current = true
      setOver(true)
      // emoji confetti overload raining across the stage
      for (let i = 0; i < 12; i++) {
        addBurst(
          REACTION_EMOJIS[Math.floor(Math.random() * REACTION_EMOJIS.length)],
          6 + Math.random() * 88,
          10 + Math.random() * 55,
          Math.round((Math.random() - 0.5) * 80),
          `over-${Date.now()}-${i}`,
        )
      }
      setTimeout(() => setOver(false), 700)
    }
    if (hype < 60) overLatch.current = false
  }, [hype, addBurst])

  // ── activity: publish lastActive (throttled) so peers can see us sleep ──
  useEffect(() => {
    const aw = provider.awareness
    if (!aw) return
    let last = 0
    const touch = () => {
      const now = Date.now()
      if (now - last < 1200) return
      last = now
      aw.setLocalStateField('user', {
        ...identity,
        lastActive: now,
        mood: moodRef.current?.emoji,
        line: moodRef.current?.line ?? null,
      })
    }
    const stage = stageRef.current
    stage?.addEventListener('pointerdown', touch)
    stage?.addEventListener('keydown', touch, true)
    const onLocalUpdate = (_update, origin) => {
      if (origin === ydoc) touch() // our own typing, not relayed remote edits
    }
    ydoc.on('update', onLocalUpdate)
    touch()
    return () => {
      stage?.removeEventListener('pointerdown', touch)
      stage?.removeEventListener('keydown', touch, true)
      ydoc.off('update', onLocalUpdate)
    }
  }, [provider, identity, ydoc])

  // publish mood changes instantly (don't wait for the throttled touch)
  useEffect(() => {
    const aw = provider.awareness
    if (!aw) return
    aw.setLocalStateField('user', {
      ...identity,
      lastActive: Date.now(),
      mood: myMood?.emoji,
      line: myMood?.line ?? null,
    })
  }, [provider, identity, myMood])

  // re-render clock so idle→asleep transitions happen without awareness noise
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 8000)
    return () => clearInterval(id)
  }, [])

  // ── sleeping cursors: dim + 💤 on remote cursors of idle peers ──────────
  // …and paint every remote cursor's label with its owner's live mood emoji.
  useEffect(() => {
    const now = Date.now()
    const sleepy = new Set(
      peers
        .filter((p) => !p.self && p.lastActive && now - p.lastActive > SLEEP_MS)
        .map((p) => p.clientId),
    )
    document.querySelectorAll('.collaboration-cursor').forEach((el) => {
      const cls = [...el.classList].find((c) => c.startsWith('collaboration-cursor--'))
      const cid = cls ? Number(cls.split('--')[1]) : NaN
      el.classList.toggle('is-sleepy', sleepy.has(cid))
      const peer = peers.find((p) => p.clientId === cid)
      const label = el.querySelector('.collaboration-cursor__label')
      if (label && peer) {
        const txt = peer.mood ? `${peer.mood} ${peer.name}` : peer.name
        if (label.textContent !== txt) label.textContent = txt
        label.title = peer.line || peer.name
      }
    })
  }, [peers, tick])

  // ── zen mode: Esc exits ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setZen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── time-rewind ─────────────────────────────────────────────────────────
  // Seed the movie from the server's edit log so rewind survives reloads.
  useEffect(() => {
    let alive = true
    history
      .then((records) => {
        if (alive && records?.length) setSeed(buildTimelineFromRecords(records))
      })
      .catch(() => {
        /* history API unreachable → live-only timeline */
      })
    return () => {
      alive = false
    }
  }, [history])

  useEffect(() => {
    const rec = createRecorder(ydoc, {
      seed: seed ?? [],
      onEvent: () => setTimeline([...rec.timeline]),
    })
    setTimeline([...rec.timeline])
    return () => rec.destroy()
  }, [ydoc, seed])

  const rewinding = rewindIdx >= 0
  const step = rewinding ? timeline[Math.min(rewindIdx, timeline.length - 1)] ?? null : null

  // Frozen Y.Doc rebuilt from the snapshot's encoded CRDT state.
  useEffect(() => {
    if (!step) {
      setPreviewDoc(null)
      return
    }
    const d = new Y.Doc()
    Y.applyUpdate(d, step.doc)
    setPreviewDoc(d)
    return () => d.destroy()
  }, [step])

  // Timelapse loop: auto-advance, stop at the present.
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      setRewindIdx((i) => {
        const next = i < 0 ? 0 : i + 1
        if (next >= timeline.length - 1) {
          setPlaying(false)
          return -1
        }
        return next
      })
    }, TIMELAPSE_MS)
    return () => clearInterval(id)
  }, [playing, timeline.length])

  function togglePlay() {
    counters.current.rewinds++
    if (playing) {
      setPlaying(false)
      return
    }
    if (rewindIdx < 0) setRewindIdx(0) // start the movie from the pad's birth
    setPlaying(true)
  }

  const goLive = useCallback(() => {
    setPlaying(false)
    setRewindIdx(-1)
  }, [])

  function scrub(v) {
    setPlaying(false)
    setRewindIdx(v)
  }

  function newPad() {
    // Fresh room = fresh random key, then a real navigation (the pad session
    // is built once per page load, so a reload is exactly what we want).
    location.href = routeUrl(newRoomKey())
  }

  function claimIdentity(next) {
    setIdentity(saveIdentity({ ...next, id: next.id || identity.id }))
  }

  return (
    <div className={`app-shell${zen ? ' is-zen' : ''}${focusPhase === 'focus' ? ' is-focusing' : ''}`}>
      <TopBar
        padId={padId}
        status={status}
        peers={peers}
        vibe={vibe}
        onPickVibe={pickVibe}
        reaction={reaction}
        onPickReaction={setReaction}
        onNewPad={newPad}
      />

      <FocusBar focusMap={focusMap} identity={identity} peers={peers} onPhase={handleFocusPhase} />

      <StreakChip count={streak} />

      <div className="room-extras">
        <GoalBar
          goalMap={goalMap}
          identity={identity}
          onCelebrate={() => celebrate(['🎯', '🎉', '✅', '🔥'])}
        />
        <LofiToggle meta={meta} />
        <CheckinBar checkinsMap={checkinsMap} identity={identity} />
      </div>


      <ToolRail
        tool={tool}
        onTool={setTool}
        onRecap={() => setShowRecap(true)}
        callActive={inCall}
        onToggleCall={() => setInCall((v) => !v)}
      />

      {tool !== 'pad' && (
        <section className={`tool-view tool-${tool}`}>
          {tool === 'tasks' && (
            <TasksPanel
              tasksArray={tasksArray}
              identity={identity}
              onCelebrate={() => celebrate(['✅', '🎉', '💪', '🔥'])}
            />
          )}
          {tool === 'doodle' && (
            <PadFrame
              storeKey="syncpad-doodle-size"
              defaultSize={{ w: 900, h: 0 }}
              presets={[
                { id: 'S', w: 620 },
                { id: 'M', w: 900 },
                { id: 'L', w: 1180 },
              ]}
            >
              <DoodlePanel doodles={doodlesArray} identity={identity} />
            </PadFrame>
          )}
          {tool === 'sticky' && (
            <PadFrame
              storeKey="syncpad-sticky-size"
              defaultSize={{ w: 940, h: 0 }}
              presets={[
                { id: 'S', w: 640 },
                { id: 'M', w: 940 },
                { id: 'L', w: 1200 },
              ]}
            >
              <StickyWall stickies={stickiesMap} identity={identity} />
            </PadFrame>
          )}
          {tool === 'sheet' && (
            <PadFrame
              storeKey="syncpad-sheet-size"
              defaultSize={{ w: 820, h: 0 }}
              presets={[
                { id: 'S', w: 560 },
                { id: 'M', w: 820 },
                { id: 'L', w: 1080 },
              ]}
            >
              <SheetPanel sheet={sheetMap} />
            </PadFrame>
          )}
          {tool === 'viewer' && (
            <PadFrame
              storeKey="syncpad-viewer-size"
              defaultSize={{ w: 980, h: 0 }}
              presets={[
                { id: 'S', w: 700 },
                { id: 'M', w: 980 },
                { id: 'L', w: 1260 },
              ]}
            >
              <ViewerPanel viewer={viewerMap} identity={identity} />
            </PadFrame>
          )}
        </section>
      )}

      <main
        className={`stage${rewinding ? ' is-rewinding' : ''}${over ? ' is-over' : ''}${
          tool !== 'pad' ? ' is-tool-hidden' : ''
        }`}
        ref={stageRef}
        onDoubleClick={dropReaction}
      >
        <HypeMeter hype={hype} combo={combo} />

        <div className="pad-live">
          <PadFrame
            zen={zen}
            onZenToggle={() => setZen((z) => !z)}
            extra={
              <SaveButton
                title="download the pad as .md"
                make={() => ({ name: `syncpad-${padId}.md`, text: padMarkdown(ydoc, padId) })}
              />
            }
          >
            <Editor
              ydoc={ydoc}
              provider={provider}
              identity={identity}
              onMood={handleMood}
              active={tool === 'pad'}
            />
          </PadFrame>
        </div>

        {step && previewDoc && (
          <div className="pad-ghost">
            <Editor key={step.seq} ydoc={previewDoc} provider={null} identity={identity} readOnly />
            <span className="ghost-tag">
              👻 frozen in time — the live pad keeps breathing behind you
            </span>
          </div>
        )}

        <ReactionLayer bursts={bursts} />
      </main>

      {timeline.length > 1 && (
        <RewindBar
          timeline={timeline}
          idx={rewindIdx}
          peers={peers}
          playing={playing}
          onPlay={togglePlay}
          onScrub={scrub}
          onLive={goLive}
        />
      )}

      <footer className="foot">
        <span>✦ double-click to react · drag the slider ◀ to rewind</span>
        <span className="foot-mid">{status === 'connected' ? 'synced' : 'edits queue locally — merge when back'}</span>
        <span>CRDT convergence · offline-first · vibe-synced</span>
      </footer>

      {inCall && myClientId > 0 && (
        <CallOverlay
          call={callMap}
          identity={identity}
          myClientId={myClientId}
          onlineIds={onlineIds}
          onLeave={() => setInCall(false)}
        />
      )}

      {showRecap && (
        <RecapCard
          ydoc={ydoc}
          timeline={timeline}
          peers={peers}
          counters={counters}
          padId={padId}
          vibe={vibe}
          onClose={() => setShowRecap(false)}
        />
      )}

      {!identity.claimed && <ClaimOverlay suggestion={identity} onClaim={claimIdentity} />}
    </div>
  )
}
