// HYPE meter — reactions charge a room-wide bar. Spam combos on your own
// client; everyone's reactions feed the shared hype. Hit 100 → overdrive
// (screen shake + emoji confetti), handled in App. Pure dopamine, zero CRDT.

const TIERS = [
  { at: 90, label: '⚡ HYPED', cls: 't-hyped' },
  { at: 65, label: '🔥 lit', cls: 't-lit' },
  { at: 35, label: '✳ warming', cls: 't-warm' },
  { at: 0, label: '☾ calm', cls: 't-calm' },
]

export default function HypeMeter({ hype, combo }) {
  const tier = TIERS.find((t) => hype >= t.at) ?? TIERS[TIERS.length - 1]
  const visible = hype > 2 || combo >= 2

  return (
    <div className={`hype ${tier.cls}${hype >= 90 ? ' is-max' : ''}${visible ? ' is-visible' : ''}`}>
      <div className="hype-track" role="meter" aria-valuenow={Math.round(hype)} aria-valuemin={0} aria-valuemax={100}>
        <div className="hype-fill" style={{ width: `${Math.min(100, hype)}%` }} />
      </div>
      <span className="hype-label">{tier.label}</span>
      {combo >= 2 && <span className="hype-combo">x{combo} combo 🔥</span>}
    </div>
  )
}
