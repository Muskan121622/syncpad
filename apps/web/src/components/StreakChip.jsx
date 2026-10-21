// 🔥 Shared pad streak — one group counter, server-tracked. Opens with the
// pad session; escalates its attitude with the number, BeReal-style:
// day 1 is hopeful, day 7 is hot, day 30+ is unhinged pride.

export default function StreakChip({ count }) {
  if (!count) {
    return (
      <div className="streak-chip is-new">
        <span>⚡ streak aaj se shuru — ek bhi edit kaafi hai</span>
      </div>
    )
  }

  const tier = count >= 30 ? 'is-legend' : count >= 7 ? 'is-hot' : ''
  const msg =
    count >= 30
      ? `${count} DIN. ye pad practically immortal hai 👑`
      : count >= 7
        ? `${count} din ka streak — mat todo 🙏`
        : count === 1
          ? 'day 1 — kal bhi aana 😌'
          : `${count} din lagataar ⚡`

  return (
    <div className={`streak-chip ${tier}`} title="consecutive days someone edited this pad">
      <span className="streak-flame">🔥</span>
      <span>{msg}</span>
    </div>
  )
}
