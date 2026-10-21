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

const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    // 🆘 Free public TURN relay (OpenRelay/Metered). STUN only DISCOVERS a
    // direct path; when both laptops sit behind symmetric NAT or an
    // AP-isolating router (very common on Indian ISPs), there IS no direct
    // path — without this relay entry the call silently connects to nothing:
    // tiles dark, no audio, while CRDT text keeps syncing happily.
    {
      urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:80?transport=tcp',
        'turn:global.relay.metered.ca:443',
        'turn:global.relay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  // Gather relay candidates BEFORE the one-shot SDP is written to the CRDT —
  // with TURN in play, 3.5s was too tight and shipped SDP without the relay.
  iceCandidatePoolSize: 4,
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
    setTimeout(res, 8000)
  })
}

export default function CallOverlay({ call, identity, myClientId, onlineIds, onLeave }) {
  const [parts, setParts] = useState({}) // clientId -> info
  const [streamErr, setStreamErr] = useState(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [sharing, setSharing] = useState(false)
  const localStream = useRef(null)
  const screenStream = useRef(null)
  const pcs = useRef(new Map()) // peerId -> RTCPeerConnection
  const streams = useRef(new Map()) // peerId -> MediaStream (for tile <video> src)
  const retries = useRef(new Map()) // peerId -> re-offer attempts (anti-loop)
  const selfRef = useRef(null)
  const started = useRef(false)

  // ── media in ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let dead = false
    async function grab() {
      try {
        localStream.current = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        })
      } catch {
        try {
          localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
          setCamOn(false)
        } catch {
          if (!dead) setStreamErr('camera & mic blocked 😅 check browser permissions')
          return
        }
      }
      if (dead || !localStream.current) return
      if (selfRef.current) selfRef.current.srcObject = localStream.current
      announce(true)
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
    setParts((p) => {
      const n = { ...p }
      delete n[id]
      return n
    })
    call.delete(`p:${id}`)
    for (const k of [...call.keys()]) {
      if (k.startsWith(`m:${id}>`) || k.endsWith(`>${id}`)) call.delete(k)
    }
  }

  // ── attach a peer's stored stream to its tile (idempotent) ───────────────
  // Called from ontrack AND from the tile's ref callback, so the stream finds
  // its <video> element no matter which one finished mounting first.
  function attachVideo(peerId) {
    const stream = streams.current.get(peerId)
    const el = document.querySelector(`video[data-peer="${peerId}"]`)
    if (!stream || !el) return
    if (el.srcObject !== stream) el.srcObject = stream
    // Autoplay with audio can still be rejected until a real user gesture —
    // muted fallback keeps the PICTURE alive; the tile tap unmutes below.
    el.play().catch(() => {
      el.muted = true
      el.play().catch(() => {})
    })
  }

  // ── negotiation ──────────────────────────────────────────────────────────
  function ensurePc(peerId) {
    let pc = pcs.current.get(peerId)
    if (pc) return pc
    pc = new RTCPeerConnection(RTC_CONFIG)
    pcs.current.set(peerId, pc)
    pc.ontrack = (e) => {
      // ALWAYS store first, attach if lucky: the remote tile's <video> may not
      // be mounted yet (peer joined a beat before React rendered it) — the
      // videoRef callback below replays the stream the moment it appears.
      // Without this the tile stayed dark forever even with media flowing.
      streams.current.set(peerId, e.streams[0])
      attachVideo(peerId)
    }
    pc.onconnectionstatechange = () => {
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

  async function sendOffer(peerId) {
    try {
      const pc = ensurePc(peerId)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await gatheringDone(pc)
      call.set(`m:${myClientId}>${peerId}`, JSON.stringify({ type: 'offer', sdp: pc.localDescription }))
    } catch (err) {
      console.error('call offer failed:', err)
    }
  }

  async function handleMsg(raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const { type, sdp } = msg
    if (type === 'offer') {
      const pc = ensurePc(msg._from)
      await pc.setRemoteDescription(sdp)
      const ans = await pc.createAnswer()
      await pc.setLocalDescription(ans)
      await gatheringDone(pc)
      call.set(`m:${myClientId}>${msg._from}`, JSON.stringify({ type: 'answer', sdp: pc.localDescription }))
    } else if (type === 'answer') {
      const pc = pcs.current.get(msg._from)
      if (pc && pc.signalingState !== 'stable') await pc.setRemoteDescription(sdp).catch(() => {})
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
    for (const { from, body } of msgs) {
      if (body.type === 'offer') handleMsg({ ...body, _from: from })
      else if (body.type === 'answer') handleMsg({ ...body, _from: from })
    }
    // smaller id initiates toward newly-seen peers with no pc yet
    for (const id of Object.keys(next)) {
      const peerId = Number(id)
      if (myClientId < peerId && !pcs.current.has(peerId)) sendOffer(peerId)
    }
  }

  useEffect(() => {
    const obs = () => syncFromMap()
    call.observe(obs)
    syncFromMap() // catch anyone already in the call
    return () => call.unobserve(obs)
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

  return (
    <div className="call-strip">
      {streamErr && <div className="call-err">{streamErr}</div>}
      <div className="call-tiles">
        {/* self tile — always muted (echo police 🚨) */}
        <div className={`call-tile is-self${camOn ? '' : ' is-camoff'}${sharing ? ' is-sharing' : ''}`}>
          <video ref={selfRef} autoPlay playsInline muted />
          <span className="call-name">
            {identity.emoji || '🧑‍🎓'} {identity.name} {sharing ? '· your screen' : '(you)'}
          </span>
          {!micOn && <span className="call-mute">🔇</span>}
          {!camOn && !sharing && <span className="call-camoff">📷 off</span>}
        </div>
        {tileIds.map((id) => {
          const p = parts[id]
          return (
            <div key={id} className={`call-tile${p.cam ? '' : ' is-camoff'}${p.share ? ' is-sharing' : ''}`}>
              <video
                data-peer={id}
                autoPlay
                playsInline
                ref={(el) => el && attachVideo(Number(id))}
                onClick={(e) => {
                  // autoplay-with-audio may have muted us — tap gives sound back
                  const v = e.currentTarget
                  v.muted = false
                  v.play().catch(() => {})
                }}
              />
              <span className="call-name">
                {p.emoji} {p.name}
                {p.share ? ' · 🖥 screen' : ''}
              </span>
              {!p.mic && <span className="call-mute">🔇</span>}
              {!p.cam && !p.share && <span className="call-camoff">📷 off</span>}
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
  )
}
