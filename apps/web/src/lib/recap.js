// Session recap — computes honest stats from CRDT data and paints a 9:16
// "story card" on a canvas (1080×1920, downloadable PNG). No screenshot
// libraries: the card is drawn natively, so it exports crisp at full res.
//
// The per-person writing share comes from the rewind timeline — every
// snapshot already carries `who: [clientIDs]` from state-vector attribution,
// so "anu wrote 62% of this pad" is cryptographically real, not a guess.

import { COLORS } from './identity.js'
import { routeLabel } from './routes.js'

const VIBE_PAINT = {
  midnight: ['#14102b', '#3a1d63', '#8b7cff'],
  vaporwave: ['#2b0f3d', '#7c1fa0', '#ff6ad5'],
  terminal: ['#03140b', '#0a3f21', '#4dff9e'],
  lofi: ['#241a12', '#5b3a24', '#ffb26b'],
}

export function computeRecap({ ydoc, timeline, peers, counters, padId, vibe }) {
  // TipTap's Collaboration stores the doc as a YXmlFragment — asking for it
  // via ydoc.getText() THROWS ("type already defined with a different
  // constructor"), which once crashed the whole app tree on recap open.
  const raw = ydoc.getXmlFragment('syncpad').toString()
  const text = raw.replace(/<[^>]*>/g, ' ')
  const words = text.trim() ? text.trim().split(/\s+/).length : 0

  const first = timeline[0]?.t
  const last = timeline[timeline.length - 1]?.t
  const grindMs = first && last ? last - first : 0

  // who → number of edit bursts they contributed (from CRDT attribution)
  const counts = new Map()
  timeline.forEach((step) => (step.who || []).forEach((cid) => counts.set(cid, (counts.get(cid) || 0) + 1)))
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1

  const byClientId = new Map(peers.map((p) => [p.clientId, p]))
  const people = [...counts.entries()]
    .map(([cid, n]) => {
      const peer = byClientId.get(cid)
      return {
        name: peer?.name || `ghost-${(Math.abs(cid) % 100000)}`,
        emoji: peer?.emoji || '👻',
        color: peer?.color || COLORS[Math.abs(cid) % COLORS.length],
        share: n / total,
        self: peer?.self || false,
      }
    })
    .sort((a, b) => b.share - a.share)
    .slice(0, 5)

  return {
    padId,
    vibe: vibe || 'midnight',
    words,
    grindMs,
    snapshots: timeline.length,
    people,
    reactions: counters?.reactions || 0,
    focusSessions: counters?.focusSessions || 0,
    rewinds: counters?.rewinds || 0,
    date: new Date(),
  }
}

const fmtGrind = (ms) => {
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r)
    return
  }
  // fallback for older canvas impls
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function glowBlob(ctx, cx, cy, r, color, alpha) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, color + alpha)
  g.addColorStop(1, color + '00')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
}

export function drawRecapCard(recap) {
  const W = 1080
  const H = 1920
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  const [bg1, bg2, accent] = VIBE_PAINT[recap.vibe] || VIBE_PAINT.midnight

  // background: diagonal gradient + soft glow blobs
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, bg1)
  g.addColorStop(1, bg2)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  glowBlob(ctx, W * 0.85, H * 0.12, 420, accent, '33')
  glowBlob(ctx, W * 0.1, H * 0.62, 500, accent, '22')

  const font = (size, weight = '700', mono = false) =>
    `${weight} ${size}px ${mono ? '"JetBrains Mono"' : '"Space Grotesk"'}, sans-serif`

  // ── header ──
  ctx.textBaseline = 'top'
  ctx.fillStyle = accent
  ctx.font = font(44)
  ctx.fillText('✦ SYNCPAD', 80, 90)
  ctx.fillStyle = '#ffffff99'
  ctx.font = font(30, '500', true)
  ctx.fillText(`pad / ${recap.padId}`, 80, 152)
  ctx.fillText(
    recap.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    80,
    198,
  )

  // ── hero stat: words ──
  ctx.fillStyle = '#ffffff'
  ctx.font = font(220, '800')
  ctx.shadowColor = accent + 'aa'
  ctx.shadowBlur = 60
  ctx.fillText(String(recap.words), 80, 320)
  ctx.shadowBlur = 0
  ctx.fillStyle = '#ffffffbb'
  ctx.font = font(44, '600')
  ctx.fillText('words on the pad', 80, 585)

  // ── grind time ──
  ctx.fillStyle = accent
  ctx.font = font(64, '800')
  ctx.fillText(fmtGrind(recap.grindMs), 80, 700)
  ctx.fillStyle = '#ffffffbb'
  ctx.font = font(36, '500')
  ctx.fillText('of collective grinding ⏱', 80, 786)

  // ── who wrote what — bars from CRDT attribution ──
  ctx.fillStyle = '#ffffff77'
  ctx.font = font(32, '700', true)
  ctx.fillText('WHO BUILT THIS', 80, 906)

  let y = 972
  for (const p of recap.people) {
    ctx.font = font(46)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(`${p.emoji} ${p.name}${p.self ? ' (you)' : ''}`.slice(0, 26), 80, y)
    ctx.fillStyle = '#ffffffcc'
    ctx.font = font(42, '800', true)
    const pct = `${Math.round(p.share * 100)}%`
    ctx.fillText(pct, W - 80 - ctx.measureText(pct).width, y)

    // bar track + fill
    const barY = y + 74
    ctx.fillStyle = '#ffffff1c'
    rr(ctx, 80, barY, W - 160, 26, 13)
    ctx.fill()
    const grad = ctx.createLinearGradient(80, 0, W - 80, 0)
    grad.addColorStop(0, p.color)
    grad.addColorStop(1, accent)
    ctx.fillStyle = grad
    rr(ctx, 80, barY, Math.max(26, (W - 160) * p.share), 26, 13)
    ctx.fill()

    y += 150
  }
  if (!recap.people.length) {
    ctx.fillStyle = '#ffffff66'
    ctx.font = font(38)
    ctx.fillText('quiet room so far… type something ✍️', 80, y)
    y += 150
  }

  // ── mini stat chips ──
  const chips = [
    [`💀 ${recap.reactions}`, 'reactions'],
    [`🍅 ${recap.focusSessions}`, 'focus sprints'],
    [`🕐 ${recap.rewinds}`, 'time rewinds'],
    [`📸 ${recap.snapshots}`, 'CRDT snapshots'],
  ]
  const chipW = (W - 160 - 3 * 24) / 4
  chips.forEach(([val, label], i) => {
    const cx = 80 + i * (chipW + 24)
    const cy = Math.max(y + 40, H - 460)
    ctx.fillStyle = '#ffffff14'
    rr(ctx, cx, cy, chipW, 170, 24)
    ctx.fill()
    ctx.strokeStyle = '#ffffff22'
    ctx.lineWidth = 2
    rr(ctx, cx, cy, chipW, 170, 24)
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = font(40, '800')
    ctx.fillText(val, cx + 22, cy + 34)
    ctx.fillStyle = '#ffffff88'
    ctx.font = font(26, '500')
    ctx.fillText(label, cx + 22, cy + 104)
  })

  // ── footer ──
  ctx.fillStyle = '#ffffff66'
  ctx.font = font(30, '500')
  ctx.fillText('your pad has a personality — make yours →', 80, H - 190)
  ctx.fillStyle = accent
  ctx.font = font(38, '800', true)
  ctx.fillText(routeLabel(recap.padId), 80, H - 138)

  return canvas
}
