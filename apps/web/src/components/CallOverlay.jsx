// 🎥 Study room call — real P2P video/voice, Google-Meet style tiles floating
// bottom-right over whatever tool is open. Zero external services: WebRTC
// handshakes (offer/answer + ICE) travel through the room's own Y.Map ('call'),
// so the CRDT document doubles as the signaling switchboard. Roles are
// deterministic — the smaller clientId always initiates — so two people
// joining at the same instant never both offer (or both wait).
//
// Map layout inside 'call':
//   p:<clientId> → JSON { name, emoji, cam, mic, share, t }   (who's in the call)
//   m:<from>><to> → JSON { type: offer|answer, sdp }   (one-shot, non-trickle:
//                   SDP is written AFTER ice gathering, candidates included)
//
// 🖥 screen share reuses the SAME peer connections: getDisplayMedia gives a
// track, every video sender does replaceTrack(screen) — no renegotiation, no
// new tiles. Friends see your screen inside your existing tile.

import { useEffect, useRef, useState } from 'react'
import { fetchIceServers } from '../lib/pad.js'

// 🌐 ICE servers. STUN only DISCOVERS a direct path; across two different-city
// NATs (Delhi↔Mumbai) / symmetric NAT / AP-isolating routers there IS no direct
// path, so a TURN RELAY is mandatory for media to ever flow. Relay credentials
// are minted by OUR backend (GET /turn → short-lived Xirsys iceServers) so the
// provider secret never ships in this public bundle. We start STUN-only and
// swap in the relay list once it loads (before we announce into any call).
const STUN_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]
let ICE_SERVERS = STUN_SERVERS
const rtcConfig = () => ({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 })

async function loadIce() {
  const turn = await fetchIceServers()
  ICE_SERVERS = turn.length ? [...STUN_SERVERS, ...turn] : STUN_SERVERS
  dbg(`ice: TURN ${turn.length ? `ON → ${turn.length} relay server(s) minted by backend` : 'OFF (STUN only — will fail across hard NAT)'}`)
}

// 🧭 call-tracer: every step lands in window.__callLog with a +ms stamp, and
// window.copyCallLog() puts the whole trace on the clipboard so a friend on a
// different network can literally paste "where did the call die". Kept OUT of
// React state — logs must survive re-renders and cost nothing.
const LOG = (globalThis.__callLog ??= [])
const t0 = Date.now()
function dbg(...args) {
  const line = `+${((Date.now() - t0) / 1000).toFixed(1)}s [call] ${args.join(' ')}`
  LOG.push(line)
  console.log(`%c🎥 ${line}`, 'color:#8b7cf6')
}
dbg(`boot: room=${(location.href.match(/\/r\/([a-z0-9]+)/i) || [])[1] ?? '?'} ua=${navigator.userAgent.slice(0, 60)}`)
globalThis.copyCallLog = async () => {
  await navigator.clipboard.writeText(LOG.join('\n'))
  console.log('📋 full call trace copied — paste it in chat')
  return LOG.length
}


// resolve once ICE candidates are baked into the SDP (or after a safety wait)
function gatheringDone(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((res) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check)
        res()
      }
    }
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(() => {
      dbg('⚠ gathering SAFETY timeout hit — shipping SDP as-is')
      res()
    }, 8000)
  })
}

export default function CallOverlay({ call, identity, myClientId, onlineIds, onLeave }) {
  const [parts, setParts] = useState({}) // clientId -> info
  const [diag, setDiag] = useState({}) // peerId -> { conn, path } — tile badge
  const [streamErr, setStreamErr] = useState(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [pinned, setPinned] = useState(null) // 'self' | peerId — big-picture spotlight
  const [floats, setFloats] = useState({}) // 🖐 per-tile free positions: key -> {x,y}
  const dragTile = useRef(null)
  const localStream = useRef(null)
  const screenStream = useRef(null)
  const pcs = useRef(new Map()) // peerId -> RTCPeerConnection
  const streams = useRef(new Map()) // peerId -> MediaStream (for tile <video> src)
  const retries = useRef(new Map()) // peerId -> re-offer attempts (anti-loop)
  const offered = useRef(new Set()) // peerId -> we already sent the FIRST offer
  const selfRef = useRef(null)
  const started = useRef(false)
  const mediaReady = useRef(false) // true only once our own cam/mic track exists

  // ── media in ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let dead = false
    async function grab() {
      const iceReady = loadIce() // fetch relay creds in parallel with the prompt
      dbg(`media: requesting cam+mic (myId=${myClientId})`)
      try {
        localStream.current = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        dbg(`media: OK cam+mic — tracks=${localStream.current.getTracks().map((t) => `${t.kind}:${t.enabled ? 'on' : 'off'}`).join(',')}`)
      } catch (e) {
        dbg(`media: cam+mic BLOCKED (${e.name}) → retry audio-only`)
        try {
          localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
          setCamOn(false)
          dbg('media: audio-only OK')
        } catch (e2) {
          dbg(`media: FATAL — mic also blocked (${e2.name})`)
          if (!dead) setStreamErr('camera & mic blocked 😅 check browser permissions')
          return
        }
      }
      if (dead || !localStream.current) return
      await iceReady // ensure relay list is loaded before we appear in any call
      if (selfRef.current) selfRef.current.srcObject = localStream.current
      mediaReady.current = true // only NOW are we allowed to offer/answer
      announce(true)
      syncFromMap() // media is live: process any queued offers + initiate ours
    }
    grab()
    return () => {
      dead = true
      announce(false)
      pcs.current.forEach((pc) => pc.close())
      pcs.current.clear()
      streams.current.clear()
      localStream.current?.getTracks().forEach((t) => t.stop()) // light off 🔴
      screenStream.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selfEntry = (extra = {}) =>
    JSON.stringify({
      name: identity.name,
      emoji: identity.emoji || '🧑🎓',
      cam: camOn && !!localStream.current?.getVideoTracks().length,
      mic: micOn,
      share: sharing,
      t: Date.now(),
      ...extra,
    })

  function announce(inCall) {
    const me = `p:${myClientId}`
    if (!inCall) {
      call.delete(me)
      for (const k of [...call.keys()]) if (k.includes(`>${myClientId}`) || k.includes(`${myClientId}>`)) call.delete(k)
      return
    }
    if (started.current) call.set(me, selfEntry())
    else {
      started.current = true
      call.set(me, selfEntry())
    }
  }

  // ── peer removal / cleanup when someone drops ────────────────────────────
  function dropPeer(id) {
    pcs.current.get(id)?.close()
    pcs.current.delete(id)
    streams.current.delete(id)
    retries.current.delete(id)
    offered.current.delete(id)
    setDiag((d) => {
      const n = { ...d }
      delete n[id]
      return n
    })
    setParts((p) => {
      const n = { ...p }
      delete n[id]
      return n
    })
    call.delete(`p:${id}`)
    for (const k of [...call.keys()]) {
      if (k.startsWith(`m:${id}>`) || k.endsWith(`>${id}`)) call.delete(k)
      else if (k.startsWith(`d:${id}:`)) call.delete(k) // 🖍️ drop their ink too
    }
  }

  // ── attach a peer's stored stream to its tile (idempotent) ───────────────
  // Called from ontrack AND from the tile's ref callback, so the stream finds
  // its <video> element no matter which one finished mounting first.
  function attachVideo(peerId) {
    const stream = streams.current.get(peerId)
    if (!stream) return
    // A pinned peer has TWO <video>s (mini tile + spotlight) sharing data-peer;
    // attach to every match so the big picture is never a black box.
    const els = document.querySelectorAll(`video[data-peer="${peerId}"]`)
    els.forEach((el) => {
      if (el.srcObject !== stream) el.srcObject = stream
      // Autoplay with audio can still be rejected until a real user gesture —
      // muted fallback keeps the PICTURE alive; the tile tap unmutes below.
      el.play().catch(() => {
        el.muted = true
        el.play().catch(() => {})
      })
    })
  }

  const noteDiag = (peerId, patch) =>
    setDiag((d) => ({ ...d, [peerId]: { ...d[peerId], ...patch } }))

  // ── negotiation ──────────────────────────────────────────────────────────
  function ensurePc(peerId) {
    let pc = pcs.current.get(peerId)
    if (pc) return pc
    dbg(`pc: creating for peer=${peerId}`)
    pc = new RTCPeerConnection(rtcConfig())
    pcs.current.set(peerId, pc)
    noteDiag(peerId, { conn: 'connecting' })
    const seenCand = []
    const ctype = (c) => c?.candidateType || /typ (\w+)/.exec(c?.candidate || '')?.[1] || '?'
    pc.onicecandidate = (e) => {
      if (!e.candidate) dbg(`pc=${peerId}: gathering complete — candidates=[${seenCand.join(',') || 'NONE ⚠️'}]`)
      else {
        seenCand.push(ctype(e.candidate))
        dbg(`pc=${peerId}: gathered ${ctype(e.candidate)} cand (total ${seenCand.length})`)
      }
    }
    pc.onicegatheringstatechange = () => dbg(`pc=${peerId}: gathering=${pc.iceGatheringState}`)
    pc.oniceconnectionstatechange = () => dbg(`pc=${peerId}: iceState=${pc.iceConnectionState}`)
    pc.ontrack = (e) => {
      dbg(`pc=${peerId}: 📥 ontrack kind=${e.track.kind} (streams=${e.streams.length})`)
      // ALWAYS store first, attach if lucky: the remote tile's <video> may not
      // be mounted yet (peer joined a beat before React rendered it) — the
      // videoRef callback below replays the stream the moment it appears.
      // Without this the tile stayed dark forever even with media flowing.
      streams.current.set(peerId, e.streams[0])
      attachVideo(peerId)
    }
    pc.onconnectionstatechange = () => {
      dbg(`pc=${peerId}: conn=${pc.connectionState}`)
      noteDiag(peerId, { conn: pc.connectionState })
      if (['failed', 'disconnected'].includes(pc.connectionState)) {
        // Drop the dead pc; if the peer is still in the call, the smaller-id
        // side re-offers once (TURN already had its chance by "failed").
        pcs.current.delete(peerId)
        pc.close()
        if (
          pc.connectionState === 'failed' &&
          myClientId < peerId &&
          call.has(`p:${peerId}`) &&
          (retries.current.get(peerId) || 0) < 2
        ) {
          retries.current.set(peerId, (retries.current.get(peerId) || 0) + 1)
          setTimeout(() => {
            if (call.has(`p:${peerId}`) && !pcs.current.has(peerId)) sendOffer(peerId)
          }, 3000)
        }
      }
    }
    localStream.current?.getTracks().forEach((t) => pc.addTrack(t, localStream.current))
    // joining mid-share? ship the screen instead of the camera
    if (sharing && screenStream.current?.getVideoTracks().length) {
      const vs = pc.getSenders().find((s) => s.track?.kind === 'video')
      const st = screenStream.current.getVideoTracks()[0]
      if (vs) vs.replaceTrack(st)
      else pc.addTrack(st, screenStream.current)
    }
    return pc
  }

  // how many a=candidate lines actually made it into a shipped SDP
  const candCount = (sdp) => ((sdp?.sdp || '').match(/^a=candidate:/gm) || []).length

  async function sendOffer(peerId) {
    try {
      dbg(`signal: → offer peer=${peerId}`)
      const pc = ensurePc(peerId)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await gatheringDone(pc)
      dbg(`signal: offer written cands=${candCount(pc.localDescription)}`)
      call.set(`m:${myClientId}>${peerId}`, JSON.stringify({ type: 'offer', sdp: pc.localDescription }))
    } catch (err) {
      dbg(`signal: ❌ offer failed peer=${peerId}: ${err?.message}`)
      console.error('call offer failed:', err)
    }
  }

  async function handleMsg(raw) {
    // syncFromMap hands us an ALREADY-parsed object; tolerate a raw JSON string too.
    let msg = raw
    if (typeof msg === 'string') {
      try {
        msg = JSON.parse(msg)
      } catch {
        return
      }
    }
    if (!msg || !msg.type) return
    const { type, sdp } = msg
    if (type === 'offer') {
      // dedupe: the re-poll below can hand us the SAME offer again; if a pc
      // already exists for this peer we've answered once — don't renegotiate.
      if (pcs.current.has(msg._from)) return
      dbg(`signal: ← offer from=${msg._from} cands=${candCount(sdp)}`)
      const pc = ensurePc(msg._from)
      await pc.setRemoteDescription(sdp)
      const ans = await pc.createAnswer()
      await pc.setLocalDescription(ans)
      await gatheringDone(pc)
      dbg(`signal: answer written to=${msg._from} cands=${candCount(pc.localDescription)}`)
      call.set(`m:${myClientId}>${msg._from}`, JSON.stringify({ type: 'answer', sdp: pc.localDescription }))
    } else if (type === 'answer') {
      dbg(`signal: ← answer from=${msg._from} cands=${candCount(sdp)}`)
      const pc = pcs.current.get(msg._from)
      if (pc && pc.signalingState !== 'stable') await pc.setRemoteDescription(sdp).catch(() => {})
      else dbg(`signal: ⚠ answer dropped (no pc or already stable) from=${msg._from}`)
    }
  }

  // ── react to everything arriving in the 'call' map ───────────────────────
  useEffect(() => {
    if (!localStream.current) return // media not ready yet; initial sync below covers it
  }, [])

  function syncFromMap() {
    const next = {}
    const msgs = []
    call.forEach((v, k) => {
      if (k.startsWith('p:') && k !== `p:${myClientId}`) {
        try {
          next[Number(k.slice(2))] = JSON.parse(v)
        } catch {
          /* ignore junk */
        }
      } else if (k.startsWith('m:')) {
        const [, fromTo] = k.split('m:')
        const [from, to] = fromTo.split('>')
        if (Number(to) === myClientId) {
          try {
            msgs.push({ from: Number(from), body: JSON.parse(v) })
          } catch {
            /* ignore */
          }
        }
      }
    })
    setParts(next)
    // Don't touch WebRTC signaling until our own media track exists: offering
    // or answering with no tracks produces a trackless SDP that gathers ZERO
    // ICE candidates (the exact cands=0 failure we traced). The 2.5s re-poll
    // and grab()'s explicit call pick everything up the instant media lands.
    if (!mediaReady.current) return
    for (const { from, body } of msgs) {
      if (body.type === 'offer') handleMsg({ ...body, _from: from })
      else if (body.type === 'answer') handleMsg({ ...body, _from: from })
    }
    // smaller id initiates ONCE toward a peer it's never contacted; after the
    // first offer the failure handler (capped retries) owns any re-negotiation,
    // so the 2.5s re-poll never turns into an endless re-offer loop.
    for (const id of Object.keys(next)) {
      const peerId = Number(id)
      if (myClientId < peerId && !pcs.current.has(peerId) && !offered.current.has(peerId)) {
        offered.current.add(peerId)
        sendOffer(peerId)
      }
    }
  }

  useEffect(() => {
    const obs = () => syncFromMap()
    call.observe(obs)
    syncFromMap() // catch anyone already in the call
    // 🪤 safety net: a CRDT-map signaling channel can MISS an offer/answer if
    // the peer mounts during the other side's ICE-gather window (observe only
    // fires on the change event, not for entries already sitting in the map at
    // subscribe time across a reconnect). Re-poll so negotiation always
    // converges — the dedupe guards above make repeat passes harmless.
    const poll = setInterval(syncFromMap, 2500)
    return () => {
      call.unobserve(obs)
      clearInterval(poll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // announce my cam/mic/screen state to peers
  useEffect(() => {
    if (started.current) call.set(`p:${myClientId}`, selfEntry())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn, camOn, sharing])

  // reap call-entries of people who left the room entirely (closed tab)
  useEffect(() => {
    if (!onlineIds) return
    call.forEach((v, k) => {
      if (!k.startsWith('p:')) return
      const id = Number(k.slice(2))
      if (id !== myClientId && !onlineIds.has(id)) dropPeer(id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineIds])

  // ── 🔬 diagnostics: which ICE path actually won? host=LAN, srflx=direct
  // across NAT, relay=through TURN (works everywhere, costs bandwidth).
  // Without this a dark tile tells you nothing about WHERE the call died.
  useEffect(() => {
    if (!Object.keys(parts).length) return
    const id = setInterval(async () => {
      for (const [peerId, pc] of pcs.current) {
        try {
          const st = await pc.getStats()
          let sel = null
          let vIn = 0
          let aIn = 0
          st.forEach((r) => {
            if (r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded'))) sel = r
            if (r.type === 'inbound-rtp' && !r.isRemote) {
              if (r.kind === 'video') vIn = r.bytesReceived || 0
              if (r.kind === 'audio') aIn = r.bytesReceived || 0
            }
          })
          if (sel) {
            const lc = st.get(sel.localCandidateId)
            const rc = st.get(sel.remoteCandidateId)
            const path = `${lc?.candidateType ?? '?'}→${rc?.candidateType ?? '?'}`
            if (path !== (diag[peerId]?.path)) dbg(`pc=${peerId}: ✅ selected path=${path}`)
            noteDiag(peerId, { path })
          }
          dbg(`pc=${peerId}: conn=${pc.connectionState} inbound v=${(vIn / 1024).toFixed(0)}KB a=${(aIn / 1024).toFixed(0)}KB`)
          noteDiag(peerId, { conn: pc.connectionState })
        } catch {
          /* pc closed mid-poll — next tick will sort it */
        }
      }
    }, 2000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts])

  // manual re-handshake: click a failed tile. Bigger-id side pokes its own
  // p: entry so the smaller-id side's observe fires and re-offers.
  function retryCall(peerId) {
    pcs.current.get(peerId)?.close()
    pcs.current.delete(peerId)
    retries.current.delete(peerId)
    offered.current.delete(peerId)
    for (const k of [...call.keys()]) {
      if (k.startsWith(`m:${myClientId}>${peerId}`) || k.startsWith(`m:${peerId}>${myClientId}`)) call.delete(k)
    }
    noteDiag(peerId, { conn: 'connecting', path: null })
    // manual tap = user intent, so the smaller-id glare rule no longer applies:
    // either side may re-offer. The offer-dedupe guard absorbs the rare case
    // where BOTH tap retry at the same instant.
    offered.current.add(peerId)
    sendOffer(peerId)
  }

  const leave = () => {
    onLeave?.()
  }

  const toggleMic = () => {
    localStream.current?.getAudioTracks().forEach((t) => (t.enabled = !micOn))
    setMicOn((v) => !v)
  }
  const toggleCam = () => {
    localStream.current?.getVideoTracks().forEach((t) => (t.enabled = !camOn))
    setCamOn((v) => !v)
  }

  // ── 🖥 screen share: same peer connections, swapped video track ──────────
  async function toggleShare() {
    if (sharing) return stopShare()
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15 } },
        audio: false,
      })
      screenStream.current = ds
      const track = ds.getVideoTracks()[0]
      track.onended = () => stopShare() // user hit the browser's own "Stop sharing"
      pcs.current.forEach((pc, peerId) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
        if (sender) sender.replaceTrack(track).catch(() => {})
        else {
          pc.addTrack(track, ds) // audio-only call → renegotiate to carry the screen
          sendOffer(peerId)
        }
      })
      if (selfRef.current) selfRef.current.srcObject = ds
      setStreamErr(null)
      setSharing(true)
    } catch {
      setStreamErr('screen share needs a real click + permission 😅')
    }
  }

  function stopShare() {
    const cam = localStream.current?.getVideoTracks()[0] || null
    pcs.current.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
      if (sender) sender.replaceTrack(cam).catch(() => {})
    })
    screenStream.current?.getTracks().forEach((t) => t.stop())
    screenStream.current = null
    if (selfRef.current) selfRef.current.srcObject = localStream.current
    setSharing(false)
  }

  const tileIds = Object.keys(parts).sort((a, b) => a - b)
  const pinnedPeer = pinned && pinned !== 'self' ? parts[pinned] : null
  const showSpot = pinned === 'self' || !!pinnedPeer

  // ── 🖍️ draw-on-their-screen — annotate the pinned shared screen. Ink is
  // synced through the SAME 'call' Y.Map under `d:` keys, so everyone looking
  // at the spotlight sees everyone's strokes. Points are normalized to the
  // video's *content* rect (the contain-fitted, letterbox-aware box) so the
  // same stroke lands on the same part of the shared screen for every viewer,
  // no matter their window size. Strokes commit on pointer-up (CRDT-cheap).
  const [strokes, setStrokes] = useState([])
  const [drawOn, setDrawOn] = useState(true)
  const [eraser, setEraser] = useState(false) // ✂️ cut mode: tap a stroke to remove it
  const [toolsOpen, setToolsOpen] = useState(true) // 🖍️ show/hide the whole draw toolbar
  const [penColor, setPenColor] = useState('#ff5d8f')
  const [penSize, setPenSize] = useState(4)
  const spotVideoRef = useRef(null)
  const spotCanvasRef = useRef(null)
  const tempStroke = useRef(null)
  const drawingPointer = useRef(false)
  const erasingPointer = useRef(false)
  const DRAW_COLORS = ['#ff5d8f', '#ffd166', '#a6e86b', '#22d3ee', '#a78bfa', '#ffffff']

  function readStrokes() {
    const arr = []
    call.forEach((v, k) => {
      if (!k.startsWith('d:')) return
      try {
        arr.push({ key: k, ...JSON.parse(v) })
      } catch {
        /* ignore junk */
      }
    })
    arr.sort((a, b) => a.seq - b.seq)
    setStrokes(arr)
  }

  useEffect(() => {
    readStrokes()
    const obs = () => readStrokes()
    call.observe(obs)
    return () => call.unobserve(obs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call])

  // the contain-fitted rectangle the real screen pixels occupy inside the box
  function contentRect() {
    const c = spotCanvasRef.current
    const v = spotVideoRef.current
    if (!c) return { x: 0, y: 0, w: 1, h: 1 }
    const cw = c.clientWidth
    const ch = c.clientHeight
    const vw = v?.videoWidth || 16
    const vh = v?.videoHeight || 9
    const s = Math.min(cw / vw, ch / vh)
    const w = vw * s
    const h = vh * s
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
  }

  function redraw() {
    const c = spotCanvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const cw = c.clientWidth
    const ch = c.clientHeight
    if (!cw || !ch) return
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr)
      c.height = Math.round(ch * dpr)
    }
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    const r = contentRect()
    const all = tempStroke.current
      ? [...strokes, tempStroke.current]
      : strokes
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of all) {
      if (!s.pts?.length) continue
      ctx.strokeStyle = s.color || '#fff'
      ctx.lineWidth = s.size || 4
      ctx.beginPath()
      s.pts.forEach(([nx, ny], i) => {
        const x = r.x + nx * r.w
        const y = r.y + ny * r.h
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      })
      ctx.stroke()
    }
  }

  // repaint on any ink / pen / layout change + whenever the box resizes
  useEffect(() => {
    if (!showSpot) return
    redraw()
    const c = spotCanvasRef.current
    if (!c || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(c)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, drawOn, penColor, penSize, showSpot, pinned])

  function toNorm(e) {
    const c = spotCanvasRef.current
    const rect = c.getBoundingClientRect()
    const r = contentRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    return [(px - r.x) / r.w, (py - r.y) / r.h]
  }

  function onDrawDown(e) {
    if (eraser) {
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      drawingPointer.current = true
      erasingPointer.current = true
      eraseAt(e)
      return
    }
    if (!drawOn) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drawingPointer.current = true
    tempStroke.current = { pts: [toNorm(e)], color: penColor, size: penSize }
    redraw()
  }
  function onDrawMove(e) {
    if (erasingPointer.current) {
      eraseAt(e)
      return
    }
    if (!drawingPointer.current || !tempStroke.current) return
    tempStroke.current.pts.push(toNorm(e))
    redraw()
  }
  function onDrawUp() {
    if (erasingPointer.current) {
      erasingPointer.current = false
      drawingPointer.current = false
      return
    }
    if (!drawingPointer.current) return
    drawingPointer.current = false
    const t = tempStroke.current
    tempStroke.current = null
    if (t && t.pts.length > 1) {
      const seq = Date.now()
      call.set(
        `d:${myClientId}:${seq}`,
        JSON.stringify({ pts: t.pts, color: t.color, size: t.size, who: identity.name, seq }),
      )
    } else {
      redraw()
    }
  }

  // ✂️ cut: vector hit-test — delete any whole stroke the pointer touches
  function eraseAt(e) {
    const c = spotCanvasRef.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    const r = contentRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const RAD = 14
    for (const s of strokes) {
      if (!s.pts?.length) continue
      const hit = s.pts.some(([nx, ny]) => {
        const x = r.x + nx * r.w
        const y = r.y + ny * r.h
        return Math.hypot(x - px, y - py) <= RAD + (s.size || 4) / 2
      })
      if (hit) call.delete(s.key)
    }
  }

  function undoMine() {
    let last = null
    for (const s of strokes) {
      if (s.key.startsWith(`d:${myClientId}:`) && (!last || s.seq > last.seq)) last = s
    }
    if (last) call.delete(last.key)
  }
  function clearAll() {
    for (const k of [...call.keys()]) if (k.startsWith('d:')) call.delete(k)
  }

  // 🖐 drag an individual tile free on screen — each video box floats on its own
  function onTileGripDown(e, key) {
    const tile = e.currentTarget.closest('.call-tile')
    if (!tile) return
    const r = tile.getBoundingClientRect()
    dragTile.current = { key, startX: e.clientX, startY: e.clientY, origLeft: r.left, origTop: r.top, w: r.width, h: r.height }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.stopPropagation()
  }
  function onTileGripMove(e) {
    const d = dragTile.current
    if (!d) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const x = Math.max(4, Math.min(d.origLeft + (e.clientX - d.startX), vw - d.w - 4))
    const y = Math.max(4, Math.min(d.origTop + (e.clientY - d.startY), vh - d.h - 4))
    setFloats((f) => ({ ...f, [d.key]: { x, y } }))
  }
  function onTileGripUp(e) {
    dragTile.current = null
    e.currentTarget?.releasePointerCapture?.(e.pointerId)
  }
  function dockTile(key) {
    setFloats((f) => {
      if (!(key in f)) return f
      const next = { ...f }
      delete next[key]
      return next
    })
  }

  return (
    <>
      {/* 📌 big-picture spotlight — click backdrop or ✕ to drop back to tiles */}
      {showSpot && (
        <div className="call-spotlight" onClick={() => setPinned(null)}>
          <div className="call-spotlight-stage" onClick={(e) => e.stopPropagation()}>
            {pinned === 'self' ? (
              <video
                key={sharing ? 'spot-screen' : 'spot-cam'}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={redraw}
                ref={(el) => {
                  spotVideoRef.current = el
                  if (el) el.srcObject = sharing ? screenStream.current : localStream.current
                }}
              />
            ) : (
              <video
                data-peer={pinned}
                autoPlay
                playsInline
                onLoadedMetadata={redraw}
                ref={(el) => {
                  spotVideoRef.current = el
                  if (el) attachVideo(Number(pinned))
                }}
              />
            )}
            {/* 🖍️ shared annotation surface over the pinned screen */}
            <canvas
              className={`call-draw-layer${drawOn || eraser ? ' is-on' : ''}${eraser ? ' is-erase' : ''}`}
              ref={(el) => {
                spotCanvasRef.current = el
              }}
              onPointerDown={onDrawDown}
              onPointerMove={onDrawMove}
              onPointerUp={onDrawUp}
              onPointerCancel={onDrawUp}
            />
            {toolsOpen ? (
              <div className="call-draw-bar">
                <button
                  type="button"
                  className={`draw-btn${drawOn && !eraser ? ' is-on' : ''}`}
                  onClick={() => {
                    setEraser(false)
                    setDrawOn((v) => !v)
                  }}
                  title={drawOn && !eraser ? 'drawing ON — click to draw, toggle off to interact with the video' : 'drawing OFF'}
                >
                  ✏️ draw
                </button>
                <button
                  type="button"
                  className={`draw-btn${eraser ? ' is-on' : ''}`}
                  onClick={() => {
                    setDrawOn(false)
                    setEraser((v) => !v)
                  }}
                  title={eraser ? 'cut ON — tap or drag over a stroke to remove it' : '✂️ cut — erase a stroke you tap'}
                >
                  ✂️ cut
                </button>
                <span className={`draw-colors${drawOn ? '' : ' is-dim'}`}>
                  {DRAW_COLORS.map((cc) => (
                    <button
                      key={cc}
                      type="button"
                      className={`draw-swatch${penColor === cc ? ' is-active' : ''}`}
                      style={{ background: cc, ['--sw']: cc }}
                      title={cc}
                      onClick={() => {
                        setPenColor(cc)
                        setEraser(false)
                        setDrawOn(true)
                      }}
                    />
                  ))}
                </span>
                <span className="draw-sizes">
                  {[3, 5, 9].map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      className={`draw-size${penSize === sz ? ' is-active' : ''}`}
                      title={`${sz}px brush`}
                      onClick={() => {
                        setPenSize(sz)
                        setEraser(false)
                        setDrawOn(true)
                      }}
                    >
                      <i style={{ width: sz + 3, height: sz + 3 }} />
                    </button>
                  ))}
                </span>
                <button type="button" className="draw-btn" onClick={undoMine} title="undo my last stroke">
                  ↩︎ undo
                </button>
                <button type="button" className="draw-btn" onClick={clearAll} title="clear everyone's ink">
                  🧽 clear
                </button>
                <button
                  type="button"
                  className="draw-btn draw-close"
                  onClick={() => setToolsOpen(false)}
                  title="hide this toolbar"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="draw-reopen"
                onClick={() => setToolsOpen(true)}
                title="show drawing tools"
              >
                🖍️
              </button>
            )}
            <div className="call-spotlight-bar">
              <span className="call-spotlight-name">
                {pinned === 'self'
                  ? `${identity.emoji || '🧑‍🎓'} ${identity.name}${sharing ? ' · 🖥 your screen' : ' (you)'}`
                  : `${pinnedPeer.emoji} ${pinnedPeer.name}${pinnedPeer.share ? ' · 🖥 screen' : ''}`}
              </span>
              <button type="button" className="call-spotlight-unpin" onClick={() => setPinned(null)}>
                ✕ unpin
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="call-strip">
      {streamErr && <div className="call-err">{streamErr}</div>}
      <div className="call-tiles">
        {/* self tile — always muted (echo police 🚨) */}
        <div
          className={`call-tile is-self${camOn ? '' : ' is-camoff'}${sharing ? ' is-sharing' : ''}${floats.self ? ' is-float' : ''}`}
          style={floats.self ? { left: floats.self.x, top: floats.self.y } : undefined}
        >
          <video ref={selfRef} autoPlay playsInline muted />
          <div
            className="call-tile-grip"
            title="drag this tile · double-click to dock back"
            onPointerDown={(e) => onTileGripDown(e, 'self')}
            onPointerMove={onTileGripMove}
            onPointerUp={onTileGripUp}
            onPointerCancel={onTileGripUp}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={() => dockTile('self')}
          >
            ⣿
          </div>
          <span className="call-name">
            {identity.emoji || '🧑‍🎓'} {identity.name} {sharing ? '· your screen' : '(you)'}
          </span>
          {!micOn && <span className="call-mute">🔇</span>}
          {!camOn && !sharing && <span className="call-camoff">📷 off</span>}
          <button
            type="button"
            className={`call-pin${pinned === 'self' ? ' is-on' : ''}`}
            title={pinned === 'self' ? 'unpin — back to tiles' : 'pin — big picture'}
            onClick={(e) => {
              e.stopPropagation()
              setPinned((p) => (p === 'self' ? null : 'self'))
            }}
          >
            📌
          </button>
        </div>
        {tileIds.map((id) => {
          const p = parts[id]
          const d = diag[id] || {}
          const conn = d.conn || 'connecting'
          const badge =
            conn === 'connected'
              ? `📶 ${d.path || 'p2p'}`
              : conn === 'failed'
                ? '💥 failed · tap to retry'
                : `⏳ ${conn}`
          return (
            <div
              key={id}
              className={`call-tile${p.cam ? '' : ' is-camoff'}${p.share ? ' is-sharing' : ''}${conn === 'failed' ? ' is-retryable' : ''}${floats[id] ? ' is-float' : ''}`}
              style={floats[id] ? { left: floats[id].x, top: floats[id].y } : undefined}
              onClick={() => {
                if (conn === 'failed') return retryCall(Number(id))
                const v = document.querySelector(`video[data-peer="${id}"]`)
                if (v) {
                  // autoplay-with-audio may have muted us — tap gives sound back
                  v.muted = false
                  v.play().catch(() => {})
                }
              }}
            >
              <video
                data-peer={id}
                autoPlay
                playsInline
                ref={(el) => el && attachVideo(Number(id))}
              />
              <div
                className="call-tile-grip"
                title="drag this tile · double-click to dock back"
                onPointerDown={(e) => onTileGripDown(e, id)}
                onPointerMove={onTileGripMove}
                onPointerUp={onTileGripUp}
                onPointerCancel={onTileGripUp}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={() => dockTile(id)}
              >
                ⣿
              </div>
              <span className={`call-diag is-${conn}`}>{badge}</span>
              <span className="call-name">
                {p.emoji} {p.name}
                {p.share ? ' · 🖥 screen' : ''}
              </span>
              {!p.mic && <span className="call-mute">🔇</span>}
              {!p.cam && !p.share && <span className="call-camoff">📷 off</span>}
              <button
                type="button"
                className={`call-pin${p.share ? ' is-hint' : ''}${pinned === id ? ' is-on' : ''}`}
                title={pinned === id ? 'unpin — back to tiles' : 'pin — big picture'}
                onClick={(e) => {
                  e.stopPropagation()
                  setPinned((cur) => (cur === id ? null : id))
                }}
              >
                📌
              </button>
            </div>
          )
        })}
      </div>
      <div className="call-bar">
        <span className="call-live">
          ● live · {1 + tileIds.length} in call · p2p, no servers 🧠
        </span>
        <button type="button" className={`call-btn${micOn ? '' : ' is-off'}`} onClick={toggleMic} title="mute / unmute (your friends hear you)">
          {micOn ? '🎤' : '🔇'}
        </button>
        <button type="button" className={`call-btn${camOn ? '' : ' is-off'}`} onClick={toggleCam} title="camera on / off">
          {camOn ? '📹' : '📷'}
        </button>
        <button
          type="button"
          className={`call-btn is-share${sharing ? ' is-on' : ''}`}
          onClick={toggleShare}
          title={sharing ? 'stop sharing your screen' : 'share your whole screen — pdf, website, anything'}
        >
          {sharing ? '🖥 stop' : '🖥 share'}
        </button>
        <button type="button" className="call-btn is-leave" onClick={leave} title="leave the call">
          📞 leave
        </button>
      </div>
      </div>
    </>
  )
}
