// Typing-mood engine — watches HOW you type and gives your cursor emoji a
// personality: 🔥 when flying, 😴 when drifting off, 😡 when you dawdle too
// long… served with Hinglish roasts. Pure frontend heuristics (WPM estimate,
// idle time, backspace ratio) — the resulting mood rides on awareness so the
// whole room sees it live.

const MOODS = {
  fire: {
    emoji: '🔥',
    lines: [
      'bhai speed!! 🚀',
      'aaj toh tu chamak rahi hai 🔥',
      'keyboard garam ho gaya 💻🔥',
      'itni jaldi kya hai 😭',
      'writer mode: ON ⚡',
    ],
  },
  happy: {
    emoji: '😊',
    lines: [
      'haan! aise hi likh rahi ho ✨',
      'mood on hai aaj 🎧',
      'slow and steady, queen 💅',
      'badiya flow hai 👏',
    ],
  },
  chill: {
    emoji: '😌',
    lines: ['set hai 🌙', 'dhire dhire, jamke likh ✍️'],
  },
  thinking: {
    emoji: '🤔',
    lines: [
      'soch rahi ho? 🤔',
      'dimag ki dhadkan… ✍️',
      'kya likhna hai bol na 🫠',
      'ideas loading… ⏳',
    ],
  },
  sleepy: {
    emoji: '😴',
    lines: [
      'so gayi? ☕',
      'zinda ho? 👀',
      'chai break pakad le 🫖',
      'cursor bhi bore ho gaya 😮‍💨',
    ],
  },
  angry: {
    emoji: '😡',
    lines: [
      '{name} jaldi likho!! ✍️',
      'bich me kya kar rahi ho?? 😤',
      'phone chhodo, type karo 📵',
      'aaj nahi toh kab nahi 😡',
      'deadline bhaag rahi hai 🏃♀️💨',
    ],
  },
  deleting: {
    emoji: '💀',
    lines: [
      'mita kaun rahi ho? 👀',
      'backspace gym opened 💪💀',
      'jo likha wo mita, phir likha 🔁',
      'perfectionist nikli 🧐',
    ],
  },
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// idle escalation (seconds since last keystroke)
const THINKING_S = 12
const SLEEPY_S = 45
const ANGRY_S = 90
const NAG_EVERY_MS = 25_000 // roast cooldown — never spammy
const WARMUP_MS = 8_000 // stay quiet right after joining

export function createMoodEngine({ name = 'yaar', onChange, tickMs = 1000 }) {
  let keys = 0
  let dels = 0
  let lastKeyAt = Date.now()
  let wpm = 0
  let moodKey = 'chill'
  let current = null
  let lineAt = 0
  const startedAt = Date.now()

  function send() {
    const now = Date.now()
    const changed = !current || current.key !== moodKey
    const idle = now - lastKeyAt
    const mood = MOODS[moodKey]

    // roast: on mood change, or recurring nag while idle/angry
    let line = null
    const nagging =
      (moodKey === 'angry' || moodKey === 'sleepy') && idle > SLEEPY_S * 1000
    if ((changed || nagging) && now - lineAt > NAG_EVERY_MS && now - startedAt > WARMUP_MS) {
      line = pick(mood.lines).replaceAll('{name}', name)
      lineAt = now
    } else if (!changed) {
      return // nothing new to report
    }

    current = { key: moodKey, emoji: mood.emoji, line }
    onChange(current)
  }

  const id = setInterval(() => {
    // rolling WPM estimate (~5 chars per word), EMA-smoothed
    const inst = ((keys * 60_000) / tickMs) * 0.2
    wpm = wpm * 0.6 + inst * 0.4

    const idleS = (Date.now() - lastKeyAt) / 1000
    let next
    if (idleS > ANGRY_S) next = 'angry'
    else if (idleS > SLEEPY_S) next = 'sleepy'
    else if (idleS > THINKING_S) next = 'thinking'
    else if (dels > keys * 0.6 && keys + dels > 12) next = 'deleting'
    else if (wpm >= 45) next = 'fire'
    else if (wpm >= 15) next = 'happy'
    else next = 'chill'

    if (next !== moodKey) moodKey = next
    send()

    keys = 0
    dels = 0
  }, tickMs)

  return {
    key() {
      keys++
      lastKeyAt = Date.now()
      // wake up dramatically from idle moods
      if (moodKey === 'thinking' || moodKey === 'sleepy' || moodKey === 'angry') {
        moodKey = 'chill'
        send()
      }
    },
    del() {
      dels++
      lastKeyAt = Date.now()
      if (moodKey === 'thinking' || moodKey === 'sleepy' || moodKey === 'angry') {
        moodKey = 'chill'
        send()
      }
    },
    destroy() {
      clearInterval(id)
    },
  }
}
